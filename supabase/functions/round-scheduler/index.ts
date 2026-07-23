// Supabase Edge Function: round-scheduler
// Deploy with: supabase functions deploy round-scheduler
//
// This function is called by a pg_cron job every 60 seconds.
// It does THREE things in sequence:
//   1. Resolve the CURRENT round (draw result, calculate wins, credit balances)
//   2. Create the NEXT round (scheduled 60s from now)
//   3. Return a summary of what happened
//
// The cron job SQL (run this in SQL editor after deploying):
// SELECT cron.schedule(
//   'bsg-round-scheduler',
//   '* * * * *',   -- every minute
//   $$SELECT net.http_post(
//     url := 'https://nkxltuucirzdctqkhnit.supabase.co/functions/v1/round-scheduler',
//     headers := jsonb_build_object(
//       'Content-Type', 'application/json',
//       'Authorization', 'Bearer <YOUR_SERVICE_ROLE_KEY>'
//     ),
//     body := '{}'::jsonb
//   )$$
// );

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (_req: Request) => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const results: Record<string, unknown> = {};

  try {
    // ── Step 1: Find the current active round ──────────────────────────
    const { data: activeRound, error: fetchErr } = await supabase
      .from("game_rounds")
      .select("*")
      .in("status", ["betting", "spinning"])
      .order("scheduled_at", { ascending: true })
      .limit(1)
      .single();

    if (fetchErr && fetchErr.code !== "PGRST116") {
      // PGRST116 = no rows found — that's OK (first ever run)
      throw new Error(`Fetch round error: ${fetchErr.message}`);
    }

    if (activeRound) {
      const scheduledAt = new Date(activeRound.scheduled_at);
      const now = new Date();

      if (now >= scheduledAt || activeRound.status === "spinning") {
        // ── Time is up — draw result and resolve ──────────────────────
        const red   = Math.floor(Math.random() * 10);
        const green = Math.floor(Math.random() * 10);
        const black = Math.floor(Math.random() * 10);

        // Mark as spinning (briefly)
        await supabase
          .from("game_rounds")
          .update({ status: "spinning" })
          .eq("id", activeRound.id);

        // Wait 8 seconds for wheel animation on clients
        await new Promise((resolve) => setTimeout(resolve, 8000));

        // Call the resolve_round RPC — draws result, credits wins, marks complete
        const { data: resolveData, error: resolveErr } = await supabase
          .rpc("resolve_round", {
            p_round_id: activeRound.id,
            p_red:      red,
            p_green:    green,
            p_black:    black,
          });

        if (resolveErr) throw new Error(`Resolve error: ${resolveErr.message}`);
        results.resolved = resolveData;
        results.round_id = activeRound.id;
        results.result = { red, green, black };
      } else {
        results.message = "Round still in betting phase, no action needed";
        results.seconds_remaining = Math.round(
          (scheduledAt.getTime() - now.getTime()) / 1000
        );
      }
    }

    // ── Step 2: Create the NEXT round if none exists ───────────────────
    const { data: existingNext, error: nextCheckErr } = await supabase
      .from("game_rounds")
      .select("id")
      .in("status", ["betting"])
      .gt("scheduled_at", new Date().toISOString())
      .limit(1)
      .single();

    if (nextCheckErr && nextCheckErr.code !== "PGRST116") {
      throw new Error(`Next round check error: ${nextCheckErr.message}`);
    }

    if (!existingNext) {
      // No upcoming betting round — create one
      const { data: newRoundId, error: createErr } = await supabase
        .rpc("create_next_round");

      if (createErr) throw new Error(`Create next round error: ${createErr.message}`);
      results.next_round_created = newRoundId;
    } else {
      results.next_round_exists = existingNext.id;
    }

    return new Response(
      JSON.stringify({ success: true, ...results }),
      { headers: { "Content-Type": "application/json" }, status: 200 }
    );

  } catch (err) {
    console.error("round-scheduler error:", err);
    return new Response(
      JSON.stringify({ success: false, error: String(err) }),
      { headers: { "Content-Type": "application/json" }, status: 500 }
    );
  }
});
