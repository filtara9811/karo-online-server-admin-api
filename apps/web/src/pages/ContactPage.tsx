import { useState } from "react";
import { Section, SectionHeader } from "@/components/sections";
import { api } from "@/lib/api";

export default function ContactPage() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api("/v1/cms/forms/contact/submit", {
        method: "POST",
        body: JSON.stringify({ data: { name, phone, message }, source_page: "/contact" }),
      });
      setDone(true);
    } catch (error) {
      setErr(error instanceof Error ? error.message : "Could not send");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section className="!pt-20">
      <SectionHeader eyebrow="Contact" title={<>Talk to <span className="ko-gold-text">Karo Online.</span></>} subtitle="Support, vendor onboarding and partnerships." />
      <div className="max-w-xl mx-auto ko-glass rounded-3xl p-8">
        {done ? (
          <p className="text-[#f5d97a]">Thank you. We will call you back.</p>
        ) : (
          <form onSubmit={submit} className="grid gap-4">
            <Field label="Name" value={name} onChange={setName} required />
            <Field label="Phone" value={phone} onChange={setPhone} required />
            <label className="grid gap-1 text-sm">
              <span className="text-white/60">Message</span>
              <textarea className="rounded-xl bg-black/30 border border-white/10 px-3 py-2 min-h-28" value={message} onChange={(e) => setMessage(e.target.value)} required />
            </label>
            <input name="website" className="hidden" tabIndex={-1} autoComplete="off" />
            {err && <p className="text-red-300 text-sm">{err}</p>}
            <button disabled={busy} className="ko-gold-bar rounded-xl py-3 font-semibold">{busy ? "Sending…" : "Send"}</button>
            <p className="text-xs text-white/40">Or email <a className="text-[#f5d97a]" href="mailto:Ashu@filipra.com">Ashu@filipra.com</a></p>
          </form>
        )}
      </div>
    </Section>
  );
}

function Field({ label, value, onChange, required }: { label: string; value: string; onChange: (v: string) => void; required?: boolean }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="text-white/60">{label}</span>
      <input className="rounded-xl bg-black/30 border border-white/10 px-3 py-2" value={value} onChange={(e) => onChange(e.target.value)} required={required} />
    </label>
  );
}
