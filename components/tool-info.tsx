import { Reveal } from "@/components/reveal";
import { toolContent } from "@/lib/tool-content";
import { SITE_URL } from "@/lib/site";
import { tools } from "@/lib/tools";

// 工具頁下方的使用說明＋常見問題區塊，並輸出
// WebApplication 與 FAQPage 兩份 JSON-LD 供搜尋引擎理解頁面。
export function ToolInfo({ slug }: { slug: string }) {
  const tool = tools.find((item) => item.slug === slug);
  const content = toolContent[slug];
  if (!tool || !content) return null;

  const appLd = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: tool.name,
    url: `${SITE_URL}/tools/${tool.slug}`,
    description: tool.description,
    applicationCategory: "UtilityApplication",
    operatingSystem: "Web",
    inLanguage: "zh-Hant",
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "TWD" },
  };
  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: content.faq.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };

  return (
    <Reveal>
    <section className="tool-info page-shell" aria-label="使用說明與常見問題">
      <div className="tool-info-column" data-rise>
        <h2>怎麼使用</h2>
        <ol className="tool-info-steps">
          {content.steps.map((step) => <li key={step}>{step}</li>)}
        </ol>
      </div>
      <div className="tool-info-column" data-rise>
        <h2>常見問題</h2>
        {content.faq.map((item) => (
          <details className="tool-info-faq" key={item.q}>
            <summary>{item.q}</summary>
            <p>{item.a}</p>
          </details>
        ))}
      </div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(appLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }} />
    </section>
    </Reveal>
  );
}
