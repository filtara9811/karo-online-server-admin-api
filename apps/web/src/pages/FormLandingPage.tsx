import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, str } from "@/lib/api";

type Field = { name: string; label?: string; type?: string; required?: boolean };

export default function FormLandingPage() {
  const { slug = "" } = useParams();
  const [title, setTitle] = useState("Form");
  const [fields, setFields] = useState<Field[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api<{ form: { title?: string; fields?: Field[] } }>(`/v1/cms/forms/${slug}`)
      .then((d) => {
        setTitle(str(d.form?.title, slug));
        setFields(Array.isArray(d.form?.fields) ? d.form.fields : []);
      })
      .catch(() => setErr("This form is not live."));
  }, [slug]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      await api(`/v1/cms/forms/${slug}/submit`, {
        method: "POST",
        body: JSON.stringify({ data: values, source_page: `/f/${slug}` }),
      });
      setDone(true);
    } catch (error) {
      setErr(error instanceof Error ? error.message : "Submit failed");
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <header className="ko-glass">
        <div className="max-w-lg mx-auto px-4 py-3">
          <Link to="/" className="font-display text-lg"><span className="ko-gold-text">Karo</span>Online</Link>
        </div>
      </header>
      <main className="max-w-lg mx-auto px-4 py-10">
        <h1 className="font-display text-4xl">{title}</h1>
        {done ? (
          <p className="mt-6 text-[#f5d97a]">Submitted. We will get back to you.</p>
        ) : (
          <form onSubmit={submit} className="grid gap-4 mt-6">
            {fields.map((f) => (
              <label key={f.name} className="grid gap-1 text-sm">
                <span className="text-white/60">{f.label ?? f.name}</span>
                {f.type === "textarea" ? (
                  <textarea className="rounded-xl bg-black/30 border border-white/10 px-3 py-2 min-h-24" required={f.required} value={values[f.name] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))} />
                ) : (
                  <input type={f.type === "tel" ? "tel" : "text"} className="rounded-xl bg-black/30 border border-white/10 px-3 py-2" required={f.required} value={values[f.name] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))} />
                )}
              </label>
            ))}
            {err && <p className="text-red-300 text-sm">{err}</p>}
            <button className="ko-gold-bar rounded-xl py-3 font-semibold">Submit</button>
          </form>
        )}
      </main>
    </div>
  );
}
