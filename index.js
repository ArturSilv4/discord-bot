// index.js
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

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  partials: [Partials.Channel],
});

const ITEM_LIST = {
  Arma: ["Ak47", "G3", "Mtar", "Parafal", "Pistola", "Tec9", "Uzi"],
  Municao: ["Munição 5mm", "Munição 762mm", "Munição 9mm"],
  Utilitario: [
    "Bandagem",
    "Combo",
    "Droga",
    "Farm",
    "Kit de reparo",
    "Kit médico",
    "Masterpick",
  ],
};

const auth = new google.auth.GoogleAuth({
  keyFile: "credenciais.json",
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

// Busca nome e baú pelo ID do Discord na aba 'usuarios' (colunas A=nome, B=bau, C=id)
async function buscarNomeEbauPorId(idDiscord) {
  const resposta = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "usuarios!A2:C",
  });
  const linhas = resposta.data.values || [];
  const linhaEncontrada = linhas.find((linha) => linha[2] === idDiscord);
  return linhaEncontrada
    ? { nome: linhaEncontrada[0], bau: linhaEncontrada[1] }
    : { nome: "-", bau: "-" };
}

// Salva registros na planilha
async function salvarNaPlanilha(dataArray, sheetName) {
  const valores = dataArray.map((item) => [
    item.Data,
    item.Jogador,
    item.ID,
    item.Baú,
    item.Item,
    item.Quantidade,
  ]);

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A1`,
    valueInputOption: "USER_ENTERED",
    resource: { values: valores },
  });
}

// Busca quantidade atual de um item na aba inventario
async function buscarQuantidadeAtual(item, abaInventario) {
  const resposta = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${abaInventario}!A2:B`,
  });

  const linhas = resposta.data.values || [];
  const linhaItem = linhas.find((linha) => linha[0] === item);
  if (!linhaItem) return 0;
  return parseInt(linhaItem[1]) || 0;
}

// Atualiza quantidade de um item na aba inventario
async function atualizarQuantidadeItem(item, novaQuantidade, abaInventario) {
  const resposta = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${abaInventario}!A2:B`,
  });
  const linhas = resposta.data.values || [];
  const index = linhas.findIndex((linha) => linha[0] === item);

  if (index === -1) {
    // Item não existe ainda no inventário: adiciona no final
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${abaInventario}!A2:B`,
      valueInputOption: "USER_ENTERED",
      resource: { values: [[item, novaQuantidade]] },
    });
  } else {
    const linhaParaAtualizar = index + 2; // +2 porque começa na linha 2
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${abaInventario}!B${linhaParaAtualizar}`,
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
    new ButtonBuilder()
      .setCustomId("entrada")
      .setLabel("✅ Entrada")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("saida")
      .setLabel("❌ Saída")
      .setStyle(ButtonStyle.Danger)
  );

  for (const canalId of registroIds) {
    const canal = guild.channels.cache.get(canalId);
    if (!canal) {
      console.error(`❌ Canal registro com ID ${canalId} não encontrado.`);
      continue;
    }
    await canal.send({ content: "Clique em um botão para registrar:", components: [row] });
  }
});

const selecoesPendentes = new Map();

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isButton()) {
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

    await interaction.reply({
      content: `📦 Selecione os itens para registrar ${tipo}:`,
      components: [new ActionRowBuilder().addComponents(select)],
      ephemeral: true,
    });
  }

  if (interaction.isStringSelectMenu()) {
    const tipo = interaction.customId.replace("selecao_", "");
    selecoesPendentes.set(interaction.user.id, { tipo, itens: interaction.values });

    const modal = new ModalBuilder()
      .setCustomId(`formulario_quantidades`)
      .setTitle("Quantidades dos Itens");

    const campos = interaction.values.slice(0, 5);
    for (const item of campos) {
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId(item)
            .setLabel(`Quantidade de ${item}`)
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
        )
      );
    }

    if (interaction.values.length > 5) {
      selecoesPendentes.get(interaction.user.id).restantes = interaction.values.slice(5);
    }

    await interaction.showModal(modal);
  }

  if (interaction.isModalSubmit()) {
    const dados = selecoesPendentes.get(interaction.user.id);
    if (!dados) return;

    await interaction.deferReply({ ephemeral: true });

    const tipo = dados.tipo; // "entrada" ou "saida"
    const itens = dados.itens;
    const id = interaction.user.id;
    const dataHora = new Date().toLocaleString("pt-BR");

    // Buscar nome e baú pelo ID
    const { nome, bau } = await buscarNomeEbauPorId(id);

    const registros = [];
    for (const item of itens) {
      const quantidade = parseInt(interaction.fields.getTextInputValue(item));
      if (!isNaN(quantidade)) {
        registros.push({
          Data: dataHora,
          Jogador: nome,
          ID: id,
          Baú: bau,
          Item: item,
          Quantidade: quantidade,
        });
      }
    }

    const canalOrigem = interaction.channelId;
    let sheetName = "Registros";
    let canalDestinoId = null;
    let abaInventario = null;

    if (canalOrigem === process.env.REGISTRO2_ID) {
      sheetName =
        tipo === "entrada"
          ? "registro_entrada_gerencia"
          : "registro_saida_gerencia";
      canalDestinoId =
        tipo === "entrada" ? process.env.ENTRADA2_ID : process.env.SAIDA2_ID;
      abaInventario = "inventario_gerencia";
    } else {
      sheetName =
        tipo === "entrada" ? "registro_entrada_membro" : "registro_saida_membro";
      canalDestinoId =
        tipo === "entrada" ? process.env.ENTRADA1_ID : process.env.SAIDA1_ID;
      abaInventario = "inventario_membro";
    }

    // Salvar registros
    await salvarNaPlanilha(registros, sheetName);

    // Atualizar inventário
    for (const registro of registros) {
      const atual = await buscarQuantidadeAtual(registro.Item, abaInventario);
      let novaQuant = atual;
      if (tipo === "entrada") {
        novaQuant = atual + registro.Quantidade;
      } else if (tipo === "saida") {
        novaQuant = atual - registro.Quantidade;
        if (novaQuant < 0) novaQuant = 0;
      }
      await atualizarQuantidadeItem(registro.Item, novaQuant, abaInventario);
    }

    // Enviar mensagens no canal destino
    const canal = interaction.guild.channels.cache.get(canalDestinoId);
    if (canal) {
      for (const entrada of registros) {
        await canal.send(
          `📦 **${tipo.toUpperCase()}** | **${entrada.Jogador}** | ID: ${entrada.ID} | Baú: ${entrada.Baú} | ${entrada.Item}: ${entrada.Quantidade}`
        );
      }
    }

    // Limpar mensagens antigas do bot no canal registro e reenviar botões
    const canalRegistro = interaction.guild.channels.cache.get(canalOrigem);
    if (canalRegistro) {
      const mensagens = await canalRegistro.messages.fetch({ limit: 50 });
      const mensagensDoBot = mensagens.filter(
        (msg) => msg.author.id === client.user.id
      );
      await canalRegistro.bulkDelete(mensagensDoBot, true).catch(() => {});

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("entrada")
          .setLabel("✅ Entrada")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId("saida")
          .setLabel("❌ Saída")
          .setStyle(ButtonStyle.Danger)
      );

      await canalRegistro.send({
        content: "Clique em um botão para registrar:",
        components: [row],
      });
    }

    selecoesPendentes.delete(interaction.user.id);

    await interaction.editReply({
      content: `✅ Registro de ${tipo} realizado com sucesso.`,
    });
  }
});

client.login(process.env.TOKEN);
