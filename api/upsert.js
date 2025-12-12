export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

    // ✅ senha: exige header X-EDIT-PASSWORD
    const required = (process.env.EDIT_PASSWORD ?? "").toString();
    const provided = (req.headers["x-edit-password"] ?? "").toString();

    if (!required) {
      return res.status(500).json({ error: "EDIT_PASSWORD não configurada na Vercel" });
    }
    if (provided !== required) {
      return res.status(401).json({ error: "Senha inválida" });
    }

    const { pageId, gtin, nome, preco, imagemUrl } = req.body || {};
    const PID = String(pageId ?? "").trim();
    const GTIN = String(gtin ?? "").trim();
    const NOME = String(nome ?? "").trim();
    const PRECO_RAW = (preco ?? "").toString().trim();
    const IMG_URL = String(imagemUrl ?? "").trim();

   // if (!GTIN) return res.status(400).json({ error: "GTIN obrigatório" });
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
    const pImg  = db.properties?.["IMAGEM"];

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
  "Nome dos Produtos": propNome(),
  "Domingas R$": propPreco(),
};

// ✅ GTIN opcional: só envia se tiver valor
if (GTIN) {
  properties["GTIN"] = propGTIN();
} else {
  // Se GTIN estiver vazio, você escolhe UMA das opções abaixo:
  // Opção A: limpar GTIN no Notion
  properties["GTIN"] = { rich_text: [] };

  // Opção B: NÃO mexer no GTIN existente no Notion (mais conservador)
  // (se escolher a Opção B, apague a linha acima)
}
    const properties = {
      "GTIN": propGTIN(),
      "Nome dos Produtos": propNome(),
      "Domingas R$": propPreco(),
    };

    if (pImg && IMG_URL) {
      properties["IMAGEM"] = {
        files: [{ name: "imagem", external: { url: IMG_URL } }]
      };
    }

    // ✅ atualiza por pageId (mais seguro)
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

    return res.status(400).json({ error: "pageId ausente. Selecione um item para editar." });
  } catch (e) {
    res.status(500).json({ error: "Erro interno", details: String(e) });
  }
}