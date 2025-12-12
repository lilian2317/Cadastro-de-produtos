export default async function handler(req, res) {
  try {
    const q = (req.query.q ?? "").toString().trim();
    const gtin = (req.query.gtin ?? "").toString().trim();
    const name = (req.query.name ?? "").toString().trim();

    const notionToken = process.env.NOTION_TOKEN;
    const dbId = process.env.NOTION_DB_ID;

    if (!notionToken || !dbId) {
      return res.status(500).json({ error: "Faltam variáveis NOTION_TOKEN / NOTION_DB_ID" });
    }

    let gtinQuery = gtin;
    let nameQuery = name;

    if (!gtinQuery && !nameQuery && q) {
      if (/^\d+$/.test(q)) gtinQuery = q;
      else nameQuery = q;
    }

    if (!gtinQuery && !nameQuery) {
      return res.status(400).json({ error: "Informe GTIN ou Nome" });
    }

    const orFilters = [];
    if (gtinQuery) {
      orFilters.push({ property: "GTIN", rich_text: { equals: gtinQuery } });
    }
    if (nameQuery) {
      orFilters.push({ property: "Nome dos Produtos", title: { contains: nameQuery } });
    }

    const r = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${notionToken}`,
        "Content-Type": "application/json",
        "Notion-Version": "2022-06-28",
      },
      body: JSON.stringify({
        filter: orFilters.length === 1 ? orFilters[0] : { or: orFilters },
        page_size: 10,
      }),
    });

    const data = await r.json();
    if (!r.ok) return res.status(500).json({ error: "Erro Notion", details: data });

    const results = data.results ?? [];
    if (!results.length) return res.status(404).json({ found: false, items: [] });

    const items = results.map((page) => {
      const props = page.properties ?? {};

      const nameOut =
        props["Nome dos Produtos"]?.title?.map(t => t.plain_text).join("") || "Sem nome";

      const preco =
        props["Domingas R$"]?.number ??
        props["Domingas R$"]?.rich_text?.map(t => t.plain_text).join("") ??
        null;

      const img =
        props["IMAGEM"]?.files?.[0]?.file?.url ??
        props["IMAGEM"]?.files?.[0]?.external?.url ??
        null;

      const gtinOut =
        props["GTIN"]?.rich_text?.map(t => t.plain_text).join("") || "";

      return { pageId: page.id, name: nameOut, preco, img, gtin: gtinOut };
    });

    res.json({ found: true, items });
  } catch (e) {
    res.status(500).json({ error: "Erro interno", details: String(e) });
  }
}