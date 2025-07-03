const {
  Client,
  GatewayIntentBits,
  Events,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  Partials,
  ChannelType,
} = require("discord.js");
require("dotenv").config();

const express = require("express");
const app = express();
app.get("/", (req, res) => res.send("Bot está rodando"));
app.listen(3000, () => console.log("🌐 Web server ativo"));

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  partials: [Partials.Channel],
});

// 🔁 Lista de conjuntos de canais por categoria
const canais = [
  {
    registro: "1381292464056569926",
    entrada: "1381292306950393977",
    saida: "1381292372431736932",
  },
  {
    registro: "1383184207236567160",
    entrada: "1383184253747204177",
    saida: "1383184284218818560",
  },
  // Você pode adicionar mais conjuntos de canais aqui
];

client.once(Events.ClientReady, async () => {
  console.log(`🤖 Bot online como ${client.user.tag}`);

  for (const grupo of canais) {
    try {
      const canal = await client.channels.fetch(grupo.registro);

      if (!canal || canal.type !== ChannelType.GuildText) {
        console.warn(`⚠️ Canal de registro com ID ${grupo.registro} não encontrado ou inválido.`);
        continue;
      }

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("entrada")
          .setLabel("✅ Entrada")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId("saida")
          .setLabel("❌ Saída")
          .setStyle(ButtonStyle.Danger),
      );

      await canal.send({
        content: "Clique em um botão para registrar:",
        components: [row],
      });
    } catch (err) {
      console.error(`❌ Erro ao enviar botão para canal ${grupo.registro}:`, err);
    }
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isButton()) {
    const tipo = interaction.customId;

    const modal = new ModalBuilder()
      .setCustomId(`form_${tipo}`)
      .setTitle(`Formulário de ${tipo === "entrada" ? "Entrada" : "Saída"}`);

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("nome")
          .setLabel("Nome do jogador")
          .setStyle(TextInputStyle.Short)
          .setRequired(true),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("id")
          .setLabel("ID do jogador")
          .setStyle(TextInputStyle.Short)
          .setRequired(true),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("bau")
          .setLabel("Número do baú")
          .setStyle(TextInputStyle.Short)
          .setRequired(true),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("itens")
          .setLabel("Itens do baú")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true),
      ),
    );

    await interaction.showModal(modal);
  }

  if (interaction.isModalSubmit()) {
    const tipo = interaction.customId.replace("form_", "");
    const nome = interaction.fields.getTextInputValue("nome");
    const id = interaction.fields.getTextInputValue("id");
    const bau = interaction.fields.getTextInputValue("bau");
    const itens = interaction.fields.getTextInputValue("itens");

    // Descobrir qual conjunto de canais pertence à interação
    const grupo = canais.find((grupo) => grupo.registro === interaction.channelId);
    if (!grupo) {
      return interaction.reply({
        content: "❌ Canal de origem não identificado. Verifique a configuração dos canais.",
        ephemeral: true,
      });
    }

    const canalIdDestino = tipo === "entrada" ? grupo.entrada : grupo.saida;
    const canalDestino = interaction.guild.channels.cache.get(canalIdDestino);

    if (!canalDestino) {
      return interaction.reply({
        content: `❌ Canal de ${tipo} não encontrado.`,
        ephemeral: true,
      });
    }

    const mensagem =
      `📦 **Registro de ${tipo === "entrada" ? "ENTRADA" : "SAÍDA"}**\n` +
      `**Nome:** ${nome}\n**ID:** ${id}\n**Baú nº:** ${bau}\n**Itens:** ${itens}`;

    await canalDestino.send(mensagem);
    await interaction.deferUpdate();
  }
});

client.login(process.env.TOKEN);
