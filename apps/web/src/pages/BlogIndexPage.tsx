import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, asList, str } from "@/lib/api";
import { Section, SectionHeader } from "@/components/sections";

export default function BlogIndexPage() {
  const [posts, setPosts] = useState<Record<string, unknown>[]>([]);
  useEffect(() => {
    api("/v1/cms/blog")
      .then((d) => setPosts(asList(d)))
      .catch(() => setPosts([]));
  }, []);

  return (
    <Section className="!pt-20">
      <SectionHeader eyebrow="Journal" title={<>Stories from the <span className="ko-gold-text">maison.</span></>} />
      <div className="grid gap-5 md:grid-cols-2">
        {posts.map((p) => (
          <Link key={str(p.slug)} to={`/blog/${str(p.slug)}`} className="ko-glass rounded-3xl p-7 hover:border-[#d4af37]/50">
            <h3 className="font-display text-2xl text-white">{str(p.title)}</h3>
            <p className="text-white/60 mt-2">{str(p.excerpt)}</p>
            <p className="text-xs text-[#f5d97a] mt-4">{str(p.author_name)} · {str(p.reading_minutes)} min</p>
          </Link>
        ))}
        {posts.length === 0 && <p className="text-white/50">No posts yet.</p>}
      </div>
    </Section>
  );
}
