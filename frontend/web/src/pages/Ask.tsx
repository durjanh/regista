import { useEffect, useRef, useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { narrationService } from "../api";
import type { AskResponse, ChatTurn } from "../api/types";
import { AgentTrace } from "../components/AgentTrace";
import { EngineBadge, FactCheckBadge } from "../components/FactCheck";
import { useMatch } from "../components/Layout";
import { ListenButton } from "../components/ListenButton";
import { CitedText } from "../components/Markdown";
import { ErrorState } from "../components/States";
import { quietly } from "../lib/activity";
import { useAnswerIn } from "../lib/answerLanguage";
import { duration } from "../lib/format";
import { usePrefs } from "../lib/prefs";
import { IconAgent, IconSend, IconUser } from "../components/icons";

/** One chat message: an avatar (you, or the analyst agent) beside the bubble. */
function Message({ from, children, live }: { from: "user" | "assistant"; children: ReactNode; live?: boolean }) {
  return (
    <div className={`msg ${from}`} aria-live={live ? "polite" : undefined}>
      <span className={from === "user" ? "avatar user" : "avatar"} title={from === "user" ? "You" : "Regista analyst agent"}>
        {from === "user" ? <IconUser /> : <IconAgent />}
      </span>
      <div className={`bubble ${from}`}>{children}</div>
    </div>
  );
}

type Turn = { role: "user"; content: string } | { role: "assistant"; content: string; res: AskResponse; lang: string } | { role: "error"; content: string };

/** An answer in the language it was asked in, or translated into the one the viewer has switched to since. */
function Answer({ res, lang }: { res: AskResponse; lang: string }) {
  const { language } = usePrefs();
  const shown = useAnswerIn(res.answer, lang, language);
  return (
    <div className="pre-wrap" translate="no" aria-busy={shown.translating}>
      <CitedText text={shown.text} citations={res.citations} />
    </div>
  );
}

export function Ask() {
  const { id = "" } = useParams();
  const match = useMatch();
  const { persona, language, t } = usePrefs();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const h = match.home.short;
  const a = match.away.short;
  const suggestions = [
    `Why did ${match.final_score.home >= match.final_score.away ? a : h} concede the ${Math.max(match.final_score.home, match.final_score.away) >= 2 ? "second" : "first"} goal?`,
    "Who controlled midfield after the break?",
    `What changed tactically for ${h} in the second half?`,
    "Which chance had the highest xG, and why?",
    "Who was the best player, by the numbers?",
    "Explain this football match to a ten-year-old.",            // "match" alone reads as a bout ("combate")
  ];

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, busy]);

  const send = async (q: string) => {
    const question = q.trim();
    if (!question || busy) return;
    const history: ChatTurn[] = turns
      .filter((x): x is Extract<Turn, { role: "user" | "assistant" }> => x.role !== "error")
      .map((x) => ({ role: x.role, content: x.content }));
    setTurns((prev) => [...prev, { role: "user", content: question }]);
    setInput("");
    setBusy(true);
    try {
      // The button and the typing bubble show progress, so the page-wide indicator stays out of it.
      const res = await quietly(() => narrationService.ask({ match_id: id, question, persona, language, history }));
      setTurns((prev) => [...prev, { role: "assistant", content: res.answer, res, lang: language }]);
    } catch (e) {
      setTurns((prev) => [...prev, { role: "error", content: e instanceof Error ? e.message : String(e) }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ask-layout">
      <section className="card chat" aria-label="Conversation">
        {turns.length === 0 ? (
          <div className="state grow">
            <div className="icon" aria-hidden="true">✦</div>
            <div>
              <strong className="fs-18">Ask Regista anything about {match.home.name} v {match.away.name}</strong>
              <div className="small muted max-52ch mt-6">
                Answers come from the match analyst agent, which calls the Regista MCP tools for every number, and are fact-checked
                before you see them.
              </div>
            </div>
          </div>
        ) : null}

        {turns.map((turn, i) =>
          turn.role === "user" ? (
            <Message key={i} from="user">
              {turn.content}
            </Message>
          ) : turn.role === "error" ? (
            <Message key={i} from="assistant">
              <ErrorState message={turn.content} />
            </Message>
          ) : (
            <Message key={i} from="assistant">
              <Answer res={turn.res} lang={turn.lang} />
              <div className="row mt-10 gap-8">
                <EngineBadge engine={turn.res.engine} />
                <FactCheckBadge fc={turn.res.fact_check} />
                <span className="grow" />
                <ListenButton small text={turn.res.answer} language={language} persona={persona} />
              </div>
              {turn.res.citations.length ? (
                <div className="chips mt-10">
                  {turn.res.citations.map((c) => (
                    <span key={c.fact_id} className="chip cursor-default">
                      <span className="fid">{c.fact_id}</span>
                      {c.label}: <b>{c.value}</b>
                    </span>
                  ))}
                </div>
              ) : null}
              {turn.res.tool_calls.length ? (
                <details className="disclosure mt-10">
                  <summary>MCP tool calls · {turn.res.tool_calls.length}</summary>
                  <div className="stack gap-6 mt-8">
                    {turn.res.tool_calls.map((tc, j) => (
                      <div key={j} className="tool-call">
                        <span>
                          <b>{tc.tool}</b>({Object.entries(tc.args).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ")})
                        </span>
                        <span className="faint">{duration(tc.ms)}</span>
                      </div>
                    ))}
                  </div>
                </details>
              ) : null}
              {turn.res.agent_trace.length ? (
                <details className="disclosure mt-6">
                  <summary>{t("feed.trace")}</summary>
                  <AgentTrace steps={turn.res.agent_trace} />
                </details>
              ) : null}
            </Message>
          ),
        )}

        {busy ? (
          <Message from="assistant" live>
            <span className="typing" aria-label="Thinking">
              <i />
              <i />
              <i />
            </span>
            <span className="xs muted ms-8">
              Analyst agent is querying the match…
            </span>
          </Message>
        ) : null}
        <div ref={endRef} />

        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <label htmlFor="ask-input" className="sr-only">
            {t("ask.placeholder")}
          </label>
          <textarea
            id="ask-input"
            className="textarea"
            placeholder={t("ask.placeholder")}
            value={input}
            rows={1}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
          />
          <button className="btn primary" type="submit" disabled={busy || !input.trim()} aria-busy={busy}>
            <IconSend /> {t("ask.send")}
          </button>
        </form>
      </section>

      <aside className="stack">
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">{t("ask.suggested")}</h2>
          </div>
          <div className="suggestions">
            {suggestions.map((s) => (
              <button key={s} className="suggestion" onClick={() => void send(s)} disabled={busy}
                aria-busy={busy && turns.at(-1)?.content === s}>
                {s}
              </button>
            ))}
          </div>
        </section>
        <section className="card small muted">
          <div className="card-title mb-8">
            How answers are grounded
          </div>
          <ol className="m-0 ps-list d-flex flex-col gap-6">
            <li>The analyst agent plans which MCP tools to call: match state, key moments, xG breakdowns or tactics.</li>
            <li>Every number in the answer comes from a tool result, tagged with a fact ID.</li>
            <li>A fact-checker agent verifies each claim, and the Fair Commentary guardrail checks the wording.</li>
          </ol>
        </section>
      </aside>
    </div>
  );
}
