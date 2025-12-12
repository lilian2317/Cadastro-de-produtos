export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

    const { gtin, nome, preco } = req.body || {};
    const GTIN = String(gtin ?? "").trim();
    const NOME = String(nome ?? "").trim();

    // preço pode ser vazio
    const PRECO_RAW = (preco ?? "").toString().trim();

    if (!GTIN) return res.status(400).json({ error: "GTIN obrigatório" });
    if (!NOME) return res.status(400).json({ error: "Nome obrigatório" });

    const notionToken = process.env.NOTION_TOKEN;
    const dbId = process.env.NOTION_DB_ID;

    // 1) Descobre os tipos das propriedades na sua database (para gravar corretamente)
    const dbResp = await fetch(`https://api.notion.com/v1/databases/${dbId}`, {
      headers: {
        "Authorization": `Bearer ${notionToken}`,
        "Notion-Version": "2022-06-28",
      },
    });
    const db = await dbResp.json();
    if (!dbResp.ok) return res.status(500).json({ error: "Erro ao ler schema do Notion", details: db });

    const pGTIN = db.properties?.["GTIN"];
    const pNome = db.properties?.["Nome dos Produtos"];
    const pPreco = db.properties?.["Domingas R$"];

    if (!pGTIN || !pNome || !pPreco) {
      return res.status(400).json({
        error: "Propriedades não encontradas. Confira os nomes no Notion.",
        details: { temGTIN: !!pGTIN, temNome: !!pNome, temPreco: !!pPreco }
      });
    }

    // 2) Procura se já existe item com esse GTIN
    const qResp = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${notionToken}`,
        "Content-Type": "application/json",
        "Notion-Version": "2022-06-28",
      },
      body: JSON.stringify({
        filter: { property: "GTIN", rich_text: { equals: GTIN } },
        page_size: 1,
      }),
    });

    const qData = await qResp.json();
    if (!qResp.ok) return res.status(500).json({ error: "Erro query Notion", details: qData });

    const existing = qData.results?.[0];

    // helpers de propriedades
    const propGTIN = () => ({ rich_text: [{ type: "text", text: { content: GTIN } }] });
    const propNome = () => ({ title: [{ type: "text", text: { content: NOME } }] });

    // preço: grava conforme o tipo real
    const propPreco = () => {
      if (!PRECO_RAW) {
        // vazio: se for number, seta null; se for rich_text, seta vazio
        return pPreco.type === "number"
          ? { number: null }
          : { rich_text: [] };
      }

      if (pPreco.type === "number") {
        // aceita "70", "70,50", "70.50"
        const normalized = PRECO_RAW.replace(/\./g, "").replace(",", ".");
        const n = Number(normalized);
        return { number: Number.isFinite(n) ? n : null };
      }

      // se não for number, guarda como texto mesmo
      return { rich_text: [{ type: "text", text: { content: PRECO_RAW } }] };
    };

    const properties = {
      "GTIN": propGTIN(),
      "Nome dos Produtos": propNome(),
      "Domingas R$": propPreco(),
    };

    // 3) Atualiza se existir; senão cria
    if (existing?.id) {
      const updResp = await fetch(`https://api.notion.com/v1/pages/${existing.id}`, {
        method: "PATCH",
        headers: {
          "Authorization": `Bearer ${notionToken}`,
          "Content-Type": "application/json",
          "Notion-Version": "2022-06-28",
        },
        body: JSON.stringify({ properties }),
      });

      const upd = await updResp.json();
      if (!updResp.ok) return res.status(500).json({ error: "Erro ao atualizar", details: upd });

      return res.json({ ok: true, mode: "updated" });
    } else {
      const createResp = await fetch(`https://api.notion.com/v1/pages`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${notionToken}`,
          "Content-Type": "application/json",
          "Notion-Version": "2022-06-28",
        },
        body: JSON.stringify({
          parent: { database_id: dbId },
          properties,
        }),
      });

      const created = await createResp.json();
      if (!createResp.ok) return res.status(500).json({ error: "Erro ao criar", details: created });

      return res.json({ ok: true, mode: "created" });
    }
  } catch (e) {
    res.status(500).json({ error: "Erro interno", details: String(e) });
  }
}
