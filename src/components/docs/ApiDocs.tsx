"use client";

import { useState, type ReactNode } from "react";
import type { DocOperation, Docs } from "@/lib/docs/spec";

interface S {
  type?: string;
  description?: string;
  properties?: Record<string, S>;
  required?: string[];
  items?: S;
  anyOf?: S[];
  enum?: unknown[];
  const?: unknown;
  format?: string;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  default?: unknown;
  examples?: unknown[];
}

function unwrap(raw: S): { s: S; nullable: boolean } {
  const options = raw.anyOf;
  if (options) {
    const rest = options.filter((o) => o.type !== "null");
    if (rest.length === 1) return { s: { ...rest[0], description: raw.description ?? rest[0]!.description }, nullable: rest.length < options.length };
  }
  return { s: raw, nullable: false };
}

function typeLabel(s: S): string {
  if (s.const !== undefined) return JSON.stringify(s.const);
  if (s.enum) return s.enum.map((v) => JSON.stringify(v)).join(" | ");
  if (s.format === "binary") return "File";
  if (s.type === "array") return `${typeLabel(s.items ?? {})}[]`;
  return s.type ?? "any";
}

function constraints(s: S): string[] {
  const c: string[] = [];
  if (s.minimum !== undefined && s.maximum !== undefined) c.push(`de ${s.minimum} à ${s.maximum}`);
  else if (s.minimum !== undefined) c.push(`≥ ${s.minimum}`);
  else if (s.maximum !== undefined) c.push(`≤ ${s.maximum}`);
  if (s.exclusiveMinimum !== undefined) c.push(`> ${s.exclusiveMinimum}`);
  if (s.minLength !== undefined && s.maxLength !== undefined) c.push(`${s.minLength} à ${s.maxLength} caractères`);
  else if (s.maxLength !== undefined) c.push(`${s.maxLength} caractères au plus`);
  if (s.pattern) c.push(`motif ${s.pattern}`);
  if (s.default !== undefined) c.push(`par défaut ${JSON.stringify(s.default)}`);
  if (s.examples?.length) c.push(`exemple ${JSON.stringify(s.examples[0])}`);
  return c;
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg className={open ? "sd-chevron is-open" : "sd-chevron"} viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <path d="M5 8l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function Model({ schema, name, open: initial = false }: { schema: S; name?: string; open?: boolean }) {
  const [open, setOpen] = useState(initial);
  const { s } = unwrap(schema);
  if (s.type !== "object" || !s.properties) return <span className="sd-type">{typeLabel(s)}</span>;
  return (
    <div className="sd-model">
      <button type="button" className="sd-model-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        {name && <span className="sd-model-name">{name}</span>}
        <span className="sd-brace">{open ? "{" : "{…}"}</span>
      </button>
      {open && (
        <>
          {name && s.description && <div className="sd-desc">{s.description}</div>}
          <table className="sd-props">
            <tbody>
              {Object.entries(s.properties).map(([key, raw]) => {
                const { s: p, nullable } = unwrap(raw);
                const items = p.type === "array" ? p.items : undefined;
                return (
                  <tr key={key}>
                    <td className="sd-prop-name">
                      {key}
                      {s.required?.includes(key) && <span className="sd-req" title="obligatoire">*</span>}
                    </td>
                    <td>
                      {p.type === "object" && p.properties ? (
                        <Model schema={p} />
                      ) : items?.type === "object" ? (
                        <>
                          <span className="sd-type">[</span>
                          <Model schema={items} />
                          <span className="sd-type">]</span>
                        </>
                      ) : (
                        <span className="sd-type">{typeLabel(p)}</span>
                      )}
                      {nullable && <span className="sd-type"> | null</span>}
                      {p.description && <div className="sd-desc">{p.description}</div>}
                      {constraints(p).length > 0 && <div className="sd-constraints">{constraints(p).join(" · ")}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <span className="sd-brace">{"}"}</span>
        </>
      )}
    </div>
  );
}

function Json({ value }: { value: unknown }) {
  return (
    <pre className="sd-json">
      <code>{JSON.stringify(value, null, 2)}</code>
    </pre>
  );
}

function ExampleOrSchema({ example, schema, name }: { example?: unknown; schema: S; name: string }) {
  const [tab, setTab] = useState<"example" | "schema">(example === undefined ? "schema" : "example");
  return (
    <div className="sd-eos">
      <div className="sd-tabs" role="tablist">
        {example !== undefined && (
          <button type="button" role="tab" aria-selected={tab === "example"} onClick={() => setTab("example")}>
            Exemple
          </button>
        )}
        <button type="button" role="tab" aria-selected={tab === "schema"} onClick={() => setTab("schema")}>
          Schéma
        </button>
      </div>
      {tab === "example" ? <Json value={example} /> : <Model schema={schema} name={name} open />}
    </div>
  );
}

interface Run {
  code: string;
  body: unknown;
  ms: number;
}

function RunResult({ run, onClear }: { run: Run; onClear: () => void }) {
  return (
    <div className="sd-run">
      <div className="sd-section-head">
        <h4>Résultat</h4>
        <button type="button" className="sd-btn" onClick={onClear}>
          Effacer
        </button>
      </div>
      <table className="sd-responses">
        <thead>
          <tr>
            <th>Code</th>
            <th>Corps ({run.ms} ms)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="sd-code">{run.code}</td>
            <td>
              <Json value={run.body} />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function TrialBody({ op, schema, trying }: { op: DocOperation; schema: S; trying: boolean }) {
  const [text, setText] = useState(JSON.stringify(op.input.example, null, 2));
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState<Run | null>(null);

  const execute = async () => {
    setBusy(true);
    const t0 = performance.now();
    try {
      const res = await fetch(op.path, { method: "POST", headers: { "content-type": op.input.contentType }, body: text });
      setRun({ code: String(res.status), body: await res.json().catch(() => null), ms: Math.round(performance.now() - t0) });
    } catch (e) {
      setRun({ code: "Erreur", body: { message: String(e) }, ms: Math.round(performance.now() - t0) });
    } finally {
      setBusy(false);
    }
  };

  if (!trying) return <ExampleOrSchema example={op.input.example} schema={schema} name={op.input.schema} />;
  return (
    <>
      <p className="sd-warning">
        Envoie une vraie demande. En local sans GOOGLE_SHEETS_WEBHOOK_URL, elle s&apos;affiche seulement dans le terminal ; sinon,
        elle arrive dans le Google Sheet.
      </p>
      <textarea className="sd-body" aria-label="Corps de la requête" value={text} onChange={(e) => setText(e.target.value)} rows={14} spellCheck={false} />
      <button type="button" className="sd-execute" disabled={busy} onClick={execute}>
        {busy ? "Envoi…" : "Exécuter"}
      </button>
      {run && <RunResult run={run} onClear={() => setRun(null)} />}
    </>
  );
}

function Operation({ op, schemas }: { op: DocOperation; schemas: Docs["schemas"] }) {
  const [open, setOpen] = useState(false);
  const [trying, setTrying] = useState(false);
  const input = schemas[op.input.schema] as S;
  return (
    <div className="sd-op sd-op-post" id={`op-${op.id}`}>
      <button type="button" className="sd-op-summary" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="sd-method">{op.method}</span>
        <span className="sd-path">{op.path}</span>
        <span className="sd-summary">{op.summary}</span>
        <Chevron open={open} />
      </button>
      {open && (
        <div className="sd-op-body">
          {op.description.map((p) => (
            <p key={p} className="sd-op-desc">
              {p}
            </p>
          ))}

          <div className="sd-section-head">
            <h4>
              {op.input.label} <span className="sd-ct">{op.input.contentType}</span>
            </h4>
            <button type="button" className={trying ? "sd-btn is-cancel" : "sd-btn"} onClick={() => setTrying(!trying)}>
              {trying ? "Annuler" : "Essayer"}
            </button>
          </div>
          <div className="sd-section">
            <TrialBody op={op} schema={input} trying={trying} />
          </div>

          <div className="sd-section-head">
            <h4>Réponses</h4>
          </div>
          <table className="sd-responses">
            <thead>
              <tr>
                <th>Code</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {op.responses.map((r) => (
                <tr key={r.code}>
                  <td className="sd-code">{r.code}</td>
                  <td>
                    <div className="sd-desc">{r.description}</div>
                    {r.schema && <ExampleOrSchema example={r.example} schema={schemas[r.schema] as S} name={r.schema} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="sd-section-head">
            <h4>Exemples d&apos;appel</h4>
          </div>
          {op.usage.map((u) => (
            <figure key={u.label} className="sd-usage">
              <figcaption>{u.label}</figcaption>
              <pre className="sd-json">
                <code>{u.code}</code>
              </pre>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}

function Tag({ name, description, children }: { name: string; description: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="sd-tag">
      <button type="button" className="sd-tag-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <h3>{name}</h3>
        <span className="sd-tag-desc">{description}</span>
        <Chevron open={open} />
      </button>
      {open && children}
    </section>
  );
}

export function ApiDocs({ docs }: { docs: Docs }) {
  return (
    <div className="sd">
      <header className="sd-topbar">
        <span className="sd-logo">SwiftStyle</span>
        <a href="/openapi.json">/openapi.json</a>
      </header>
      <main className="sd-wrap">
        <div className="sd-info">
          <h1>
            {docs.title} <span className="sd-pill">{docs.version}</span> <span className="sd-pill is-oas">généré depuis le code</span>
          </h1>
          {docs.description.map((p) => (
            <p key={p}>{p}</p>
          ))}
          <p>
            Format OpenAPI 3.1 : <a href="/openapi.json">/openapi.json</a>.
          </p>
          {docs.links.map((l) => (
            <a key={l.href} className="sd-link-card" href={l.href} target="_blank" rel="noreferrer">
              <strong>{l.label} →</strong>
              <span>{l.description}</span>
              <code>{l.href}</code>
            </a>
          ))}
        </div>

        {docs.tags.map((tag) => (
          <Tag key={tag.name} name={tag.name} description={tag.description}>
            {docs.operations
              .filter((op) => op.tag === tag.name)
              .map((op) => (
                <Operation key={op.id} op={op} schemas={docs.schemas} />
              ))}
          </Tag>
        ))}

        <Tag name="Schémas" description="Formes des données échangées, déduites des schémas zod du code.">
          <div className="sd-models">
            {Object.entries(docs.schemas).map(([name, schema]) => (
              <Model key={name} schema={schema as S} name={name} />
            ))}
          </div>
        </Tag>
      </main>
    </div>
  );
}

