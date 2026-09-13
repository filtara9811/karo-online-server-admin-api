import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, str } from "@/lib/api";
import { Section } from "@/components/sections";

export default function BlogPostPage() {
  const { slug = "" } = useParams();
  const [post, setPost] = useState<Record<string, unknown> | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    api<{ post: Record<string, unknown> }>(`/v1/cms/blog/${slug}`)
      .then((d) => setPost(d.post))
      .catch(() => setMissing(true));
  }, [slug]);

  return (
    <Section className="!pt-20 max-w-3xl">
      <Link to="/blog" className="text-[#f5d97a] text-sm">← Journal</Link>
      {missing && <p className="mt-6 text-white/60">This story is not published.</p>}
      {post && (
        <>
          <h1 className="font-display text-4xl md:text-5xl text-white mt-4">{str(post.title)}</h1>
          <p className="text-white/50 text-sm mt-2">{str(post.author_name)}</p>
          <div className="mt-8 text-white/75 leading-relaxed whitespace-pre-wrap">{str(post.body ?? post.excerpt)}</div>
        </>
      )}
    </Section>
  );
}
