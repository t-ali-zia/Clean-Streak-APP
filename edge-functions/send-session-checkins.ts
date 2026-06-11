// Supabase Edge Function: send-session-checkins
// Sends the daily session check-in push. Schedule it TWICE (see cron SQL
// in the README section below): once in the morning window and once at
// night. The function infers the window from the UTC hour, so each run
// only notifies users whose session_reminder preference matches.
//
// Required secrets (same as send-notifications):
//   SUPABASE_URL, SERVICE_ROLE_KEY (legacy JWT), VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;

webpush.setVapidDetails("mailto:turabzia@gmail.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

function dateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

Deno.serve(async () => {
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Window: runs before 12:00 UTC count as "morning", after as "night".
  const now = new Date();
  const window = now.getUTCHours() < 12 ? "morning" : "night";
  // Morning asks about yesterday; night asks about today.
  const target = window === "morning"
    ? dateStr(new Date(now.getTime() - 86400000))
    : dateStr(now);

  const { data: subs } = await sb.from("push_subscriptions").select("user_id, subscription");
  if (!subs || !subs.length) return new Response("no subscriptions");

  const userIds = subs.map((s) => s.user_id);
  const { data: profiles } = await sb.from("user_profiles")
    .select("id, session_reminder").in("id", userIds);
  const prefById: Record<string, string> = {};
  (profiles || []).forEach((p) => { prefById[p.id] = p.session_reminder || "night"; });

  const { data: habits } = await sb.from("habits")
    .select("id, user_id, name").eq("habit_type", "build").in("user_id", userIds);
  const habitsByUser: Record<string, { id: string; name: string }[]> = {};
  (habits || []).forEach((h) => {
    (habitsByUser[h.user_id] = habitsByUser[h.user_id] || []).push({ id: h.id, name: h.name });
  });

  const { data: logged } = await sb.from("sessions")
    .select("user_id, habit_id").eq("session_date", target).in("user_id", userIds);
  const loggedByUser: Record<string, Set<string>> = {};
  (logged || []).forEach((s) => {
    (loggedByUser[s.user_id] = loggedByUser[s.user_id] || new Set()).add(s.habit_id);
  });

  let sent = 0;
  const dayWord = window === "morning" ? "yesterday" : "today";

  for (const sub of subs) {
    if (prefById[sub.user_id] !== window) continue;
    const userHabits = habitsByUser[sub.user_id] || [];
    if (!userHabits.length) continue;
    // Skip if every build habit is already logged for the target date.
    const done = loggedByUser[sub.user_id] || new Set();
    if (userHabits.every((h) => done.has(h.id))) continue;

    const payload = userHabits.length === 1
      ? {
          title: `Did you do ${userHabits[0].name} ${dayWord}?`,
          body: "Tap to log it — keep the streak alive.",
          url: "/?checkin=1",
          tag: "session-checkin",
        }
      : {
          title: "Session check-in",
          body: `Did you do your sessions ${dayWord}? Tap to answer.`,
          url: "/?checkin=1",
          tag: "session-checkin",
        };

    try {
      await webpush.sendNotification(sub.subscription, JSON.stringify(payload));
      sent++;
    } catch (e) {
      // 404/410 = subscription expired; clean it up.
      if (e.statusCode === 404 || e.statusCode === 410) {
        await sb.from("push_subscriptions").delete().eq("user_id", sub.user_id);
      }
    }
  }

  return new Response(`window=${window} target=${target} sent=${sent}`);
});
