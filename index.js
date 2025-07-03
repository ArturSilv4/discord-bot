const {
  Client,
  GatewayIntentBits,
  Events,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  Partials,
} = require("discord.js");
const { google } = require("googleapis");
require("dotenv").config();
const fs = require("fs");

// Tratamento global de erros
process.on("unhandledRejection", err => console.error("❌ Rejeição não tratada:", err));
process.on("uncaughtException", err => console.error("❌ Exceção não tratada:", err));

// Verificação inicial de variáveis
if (!fs.existsSync("credenciais.json") || !process.env.SPREADSHEET_ID) {
  console.error("❌ Arquivo credenciais.json ou SPREADSHEET_ID ausente.");
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  partials: [Partials.Channel],
});

const ITEM_LIST = {
  Arma: ["Ak47", "G3", "Mtar", "Parafal", "Pistola", "Tec9", "Uzi"],
  Municao: ["Munição 5mm", "Munição 762mm", "Munição 9mm"],
  Utilitario: [
    "Bandagem", "Combo", "Droga", "Farm",
    "Kit de reparo", "Kit médico", "Masterpick"
  ],
};

const auth = new google.auth.GoogleAuth({
  keyFile: "credenciais.json",
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

async function buscarNomeEbauPorId(idDiscord) {
  const resposta = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "usuarios!A2:C",
  });
  const linhas = resposta.data.values || [];
  const achou = linhas.find(l => l[2] === idDiscord);
  return achou ? { nome: achou[0], bau: achou[1] } : { nome: "-", bau: "-" };
}

async function salvarNaPlanilha(dados, aba) {
  const valores = dados.map(i => [
    i.Data, i.Jogador, i.ID, i.Baú, i.Item, i.Quantidade
  ]);
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${aba}!A1`,
    valueInputOption: "USER_ENTERED",
    resource: { values: valores },
  });
}

async function buscarQuantidadeAtual(item, aba) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${aba}!A2:B`,
  });
  const linhas = res.data.values || [];
  const linha = linhas.find(l => l[0] === item);
  return linha ? parseInt(linha[1]) || 0 : 0;
}

async function atualizarQuantidadeItem(item, novaQuantidade, aba) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${aba}!A2:B`,
  });
  const linhas = res.data.values || [];
  const index = linhas.findIndex(l => l[0] === item);

  if (index === -1) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${aba}!A2:B`,
      valueInputOption: "USER_ENTERED",
      resource: { values: [[item, novaQuantidade]] },
    });
  } else {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${aba}!B${index + 2}`,
      valueInputOption: "USER_ENTERED",
      resource: { values: [[novaQuantidade]] },
    });
  }
}

client.once(Events.ClientReady, async () => {
  console.log(`🤖 Bot online como ${client.user.tag}`);
  const guild = await client.guilds.fetch(process.env.GUILD_ID);
  const registroIds = [process.env.REGISTRO1_ID, process.env.REGISTRO2_ID];

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("entrada").setLabel("✅ Entrada").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("saida").setLabel("❌ Saída").setStyle(ButtonStyle.Danger)
  );

  for (const canalId of registroIds) {
    const canal = guild.channels.cache.get(canalId);
    if (canal?.permissionsFor(client.user)?.has("SendMessages")) {
      await canal.send({ content: "Clique em um botão para registrar:", components: [row] });
    }
  }
});

const selecoesPendentes = new Map();

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isButton()) {
      await interaction.deferReply({ ephemeral: true });
      const tipo = interaction.customId;

      const options = [];
      for (const categoria in ITEM_LIST) {
        for (const item of ITEM_LIST[categoria].sort()) {
          options.push({ label: item, value: item });
        }
      }

      const select = new StringSelectMenuBuilder()
        .setCustomId(`selecao_${tipo}`)
        .setPlaceholder("Selecione os itens")
        .setMinValues(1)
        .setMaxValues(Math.min(25, options.length))
        .addOptions(options);

      await interaction.editReply({
        content: `📦 Selecione os itens para registrar ${tipo}:`,
        components: [new ActionRowBuilder().addComponents(select)],
      });
    }

    else if (interaction.isStringSelectMenu()) {
      const tipo = interaction.customId.replace("selecao_", "");
      selecoesPendentes.set(interaction.user.id, { tipo, itens: interaction.values });

      const modal = new ModalBuilder().setCustomId("formulario_quantidades").setTitle("Quantidades dos Itens");

      for (const item of interaction.values.slice(0, 5)) {
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId(item).setLabel(`Quantidade de ${item}`).setStyle(TextInputStyle.Short).setRequired(true)
          )
        );
      }

      if (interaction.values.length > 5) {
        selecoesPendentes.get(interaction.user.id).restantes = interaction.values.slice(5);
      }

      await interaction.showModal(modal);
    }

    else if (interaction.isModalSubmit()) {
      const dados = selecoesPendentes.get(interaction.user.id);
      if (!dados) {
        await interaction.reply({ content: "❌ Dados não encontrados. Tente novamente.", ephemeral: true });
        return;
      }

      await interaction.deferReply({ ephemeral: true });
      const tipo = dados.tipo;
      const itens = dados.itens;
      const id = interaction.user.id;
      const dataHora = new Date().toLocaleString("pt-BR");
      const { nome, bau } = await buscarNomeEbauPorId(id);

      const registros = [];
      for (const item of itens) {
        const quantidade = parseInt(interaction.fields.getTextInputValue(item));
        if (!isNaN(quantidade)) {
          registros.push({ Data: dataHora, Jogador: nome, ID: id, Baú: bau, Item: item, Quantidade: quantidade });
        }
      }

      const canalOrigem = interaction.channelId;
      let sheetName = "", canalDestinoId = "", abaInventario = "";

      if (canalOrigem === process.env.REGISTRO2_ID) {
        sheetName = tipo === "entrada" ? "registro_entrada_gerencia" : "registro_saida_gerencia";
        canalDestinoId = tipo === "entrada" ? process.env.ENTRADA2_ID : process.env.SAIDA2_ID;
        abaInventario = "inventario_gerencia";
      } else {
        sheetName = tipo === "entrada" ? "registro_entrada_membro" : "registro_saida_membro";
        canalDestinoId = tipo === "entrada" ? process.env.ENTRADA1_ID : process.env.SAIDA1_ID;
        abaInventario = "inventario_membro";
      }

      await salvarNaPlanilha(registros, sheetName);

      for (const registro of registros) {
        const atual = await buscarQuantidadeAtual(registro.Item, abaInventario);
        const nova = tipo === "entrada"
          ? atual + registro.Quantidade
          : Math.max(0, atual - registro.Quantidade);
        await atualizarQuantidadeItem(registro.Item, nova, abaInventario);
      }

      const canal = interaction.guild?.channels?.cache.get(canalDestinoId);
      if (canal?.permissionsFor(client.user)?.has("SendMessages")) {
        for (const entrada of registros) {
          await canal.send(`📦 **${tipo.toUpperCase()}** | **${entrada.Jogador}** | ID: ${entrada.ID} | Baú: ${entrada.Baú} | ${entrada.Item}: ${entrada.Quantidade}`);
        }
      }

      const canalRegistro = interaction.guild?.channels?.cache.get(canalOrigem);
      if (canalRegistro) {
        const msgs = await canalRegistro.messages.fetch({ limit: 50 });
        const doBot = msgs.filter(m => m.author.id === client.user.id);
        try {
          await canalRegistro.bulkDelete(doBot, true);
        } catch (e) {
          console.warn("⚠️ Falha ao deletar mensagens:", e.message);
        }

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("entrada").setLabel("✅ Entrada").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId("saida").setLabel("❌ Saída").setStyle(ButtonStyle.Danger)
        );

        await canalRegistro.send({ content: "Clique em um botão para registrar:", components: [row] });
      }

      selecoesPendentes.delete(interaction.user.id);
      await interaction.editReply({ content: `✅ Registro de ${tipo} realizado com sucesso.` });
    }
  } catch (err) {
    console.error("❌ Erro na interação:", err);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: "❌ Erro ao processar a solicitação." });
    } else {
      await interaction.reply({ content: "❌ Erro inesperado.", ephemeral: true });
    }
  }
});

client.login(process.env.TOKEN);
