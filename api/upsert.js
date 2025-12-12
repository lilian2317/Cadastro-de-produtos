export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

    const { pageId, gtin, nome, preco, imagemUrl } = req.body || {};
    const PID = String(pageId ?? "").trim();
    const GTIN = String(gtin ?? "").trim();
    const NOME = String(nome ?? "").trim();
    const PRECO_RAW = (preco ?? "").toString().trim();
    const IMG_URL = String(imagemUrl ?? "").trim();

    if (!GTIN) return res.status(400).json({ error: "GTIN obrigatório" });
    if (!NOME) return res.status(400).json({ error: "Nome obrigatório" });

    const notionToken = process.env.NOTION_TOKEN;
    const dbId = process.env.NOTION_DB_ID;

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
    const pImg  = db.properties?.["IMAGEM"]; // pode existir ou não

    if (!pGTIN || !pNome || !pPreco) {
      return res.status(400).json({
        error: "Propriedades não encontradas. Confira os nomes no Notion.",
        details: { temGTIN: !!pGTIN, temNome: !!pNome, temPreco: !!pPreco, temImg: !!pImg }
      });
    }

    const propGTIN = () => ({ rich_text: [{ type: "text", text: { content: GTIN } }] });
    const propNome = () => ({ title: [{ type: "text", text: { content: NOME } }] });

    const propPreco = () => {
      if (!PRECO_RAW) return pPreco.type === "number" ? { number: null } : { rich_text: [] };

      if (pPreco.type === "number") {
        const normalized = PRECO_RAW.replace(/\./g, "").replace(",", ".");
        const n = Number(normalized);
        return { number: Number.isFinite(n) ? n : null };
      }
      return { rich_text: [{ type: "text", text: { content: PRECO_RAW } }] };
    };

    const properties = {
      "GTIN": propGTIN(),
      "Nome dos Produtos": propNome(),
      "Domingas R$": propPreco(),
    };

    // IMAGEM (opcional): se você quiser editar via URL
    if (pImg && IMG_URL) {
      properties["IMAGEM"] = {
        files: [
          { name: "imagem", external: { url: IMG_URL } }
        ]
      };
    }

    // ✅ Se veio pageId, atualiza esse item (mais seguro)
    if (PID) {
      const updResp = await fetch(`https://api.notion.com/v1/pages/${PID}`, {
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
    }

    // Caso não venha pageId, faz upsert por GTIN
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