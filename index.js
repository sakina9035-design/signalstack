export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: cors });

    /* -------------------------
       HEALTH CHECK
    ------------------------- */
    if (url.pathname === "/" && request.method === "GET") {
      return new Response("Product Signal Engine running", {
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    }

    /* -------------------------
       AI TAGGING (Workers AI)
    ------------------------- */
    async function tagWithAI(text) {
      const fallback = {
        theme: "Other",
        urgency: "Medium",
        severity: "Moderate",
        sentiment: "Neutral",
      };

      if (!env.AI) return fallback;

      const prompt = `
Classify the following product feedback.

"${text}"

Return ONLY valid JSON:
{
  "theme": "Authentication | Performance | UI/UX | Documentation | Bug | Feature Request | Integration | Other",
  "urgency": "Low | Medium | High",
  "severity": "Minor | Moderate | Critical",
  "sentiment": "Positive | Neutral | Negative"
}
`;

      try {
        const ai = await env.AI.run("@cf/meta/llama-3-8b-instruct", {
          messages: [{ role: "user", content: prompt }],
        });

        const cleaned = String(ai.response || "")
          .replace(/```json/g, "")
          .replace(/```/g, "")
          .trim();

        return JSON.parse(cleaned);
      } catch {
        return fallback;
      }
    }

    /* -------------------------
       INGEST FEEDBACK
    ------------------------- */
    if (url.pathname === "/feedback" && request.method === "POST") {
      const body = await request.json();
      const { text, source, timestamp } = body || {};

      if (!text || !source || !timestamp) {
        return json({ error: "text, source, timestamp required" }, 400);
      }

      const tags = await tagWithAI(text);

      await env.DB.prepare(
        `INSERT INTO feedback
         (text, source, timestamp, created_at, theme, urgency, severity, sentiment, escalated)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`
      )
        .bind(
          text,
          source,
          timestamp,
          new Date().toISOString(),
          tags.theme,
          tags.urgency,
          tags.severity,
          tags.sentiment
        )
        .run();

      return json({ status: "stored", tags });
    }

    /* -------------------------
       STATS (PM SUMMARY)
    ------------------------- */
    if (url.pathname === "/stats" && request.method === "GET") {
      const stats = await env.DB.prepare(
        `SELECT
          COUNT(*) as total,
          SUM(CASE WHEN urgency='High' THEN 1 ELSE 0 END) as high_urgency,
          SUM(CASE WHEN severity='Critical' THEN 1 ELSE 0 END) as critical,
          SUM(CASE WHEN sentiment='Negative' THEN 1 ELSE 0 END) as negative
         FROM feedback`
      ).first();

      let summary = "Feedback volume is low risk.";
      if (stats.negative > stats.total / 2) {
        summary = "User sentiment is trending negative.";
      } else if (stats.high_urgency > 0 || stats.critical > 0) {
        summary = "Urgent issues detected that may require prioritization.";
      }

      return json({
        ...stats,
        summary,
      });
    }

    /* -------------------------
       CLUSTERS (PRIORITIZED INSIGHTS)
    ------------------------- */
    if (url.pathname === "/clusters" && request.method === "GET") {
      const { results } = await env.DB.prepare(
        `SELECT
          theme,
          COUNT(*) as coverage,
          AVG(CASE urgency WHEN 'High' THEN 3 WHEN 'Medium' THEN 2 ELSE 1 END) as avg_urgency,
          AVG(CASE severity WHEN 'Critical' THEN 3 WHEN 'Moderate' THEN 2 ELSE 1 END) as avg_severity
         FROM feedback
         GROUP BY theme`
      ).all();

      const clusters = results.map((r) => {
        const priority = r.coverage * r.avg_urgency * r.avg_severity;

        let insight = "Recurring user feedback detected.";
        let recommendation = "Monitor and review in upcoming sprint.";

        if (r.theme === "Other") {
          insight = "Large volume of uncategorized feedback suggests taxonomy gaps.";
          recommendation =
            "Refine AI classification prompts or expand feedback categories.";
        } else if (priority > 20) {
          insight = "High-impact issue affecting multiple users.";
          recommendation = "Prioritize investigation and remediation.";
        }

        return {
          theme: r.theme,
          coverage: r.coverage,
          avg_urgency: Number(r.avg_urgency.toFixed(2)),
          avg_severity: Number(r.avg_severity.toFixed(2)),
          priority: Number(priority.toFixed(2)),
          insight,
          recommendation,
        };
      }).sort((a, b) => b.priority - a.priority);

      return json({
        top_problem: clusters[0] || null,
        clusters,
      });
    }

    /* -------------------------
       SEED MOCK DATA
    ------------------------- */
    if (url.pathname === "/seed" && request.method === "GET") {
      const samples = [
        { text: "Login fails for enterprise users", source: "GitHub" },
        { text: "SSO integration breaks randomly", source: "Support" },
        { text: "Dashboard takes more than 10 seconds to load", source: "Discord" },
        { text: "API latency is very high during peak hours", source: "GitHub" },
        { text: "Documentation is outdated for v2 APIs", source: "Email" },
        { text: "Navigation is confusing in settings screen", source: "Twitter" },
        { text: "Need export to CSV feature", source: "Support" },
        { text: "Bug in report generation", source: "Support" },
      ];

      for (const s of samples) {
        const tags = await tagWithAI(s.text);
        const ts = new Date().toISOString();

        await env.DB.prepare(
          `INSERT INTO feedback
           (text, source, timestamp, created_at, theme, urgency, severity, sentiment, escalated)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`
        )
          .bind(
            s.text,
            s.source,
            ts,
            ts,
            tags.theme,
            tags.urgency,
            tags.severity,
            tags.sentiment
          )
          .run();
      }

      return json({ status: "seeded", count: samples.length });
    }

    return new Response("Not found", { status: 404, headers: cors });
  },
};
