import { useEffect, useState } from "react";
import { api, str } from "@/lib/api";
import { Section } from "@/components/sections";

export default function LegalPage({ slug }: { slug: string }) {
  const [page, setPage] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    api<{ page: Record<string, unknown> }>(`/v1/cms/legal/${slug}`)
      .then((d) => setPage(d.page))
      .catch(() => setPage({ title: slug, html: "<p>This policy will appear once published in admin.</p>" }));
  }, [slug]);

  return (
    <Section className="!pt-20 max-w-3xl">
      <h1 className="font-display text-4xl text-white">{str(page?.title, slug)}</h1>
      <div className="mt-6 text-white/70 leading-relaxed prose-p:mb-4" dangerouslySetInnerHTML={{ __html: str(page?.html, "") }} />
    </Section>
  );
}
