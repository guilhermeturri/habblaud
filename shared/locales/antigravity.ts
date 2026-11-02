// Traduções isoladas do Google Antigravity para evitar conflitos de merge em shared/locales/{en,es,fr}.ts
// quando o fork for atualizado com o repositório original (upstream).

export const EN_ANTIGRAVITY: Readonly<Record<string, string>> = {
  "Para mandar mensagens ao Antigravity: rode npm run antigravity:install no computador":
    "To send messages to Antigravity: run npm run antigravity:install on your computer",
  "eventos do Antigravity só são aceitos pelo próprio computador (http://localhost ou http://127.0.0.1)":
    "Antigravity events are only accepted from this computer (http://localhost or http://127.0.0.1)",
  "Antigravity ({0})": "Antigravity ({0})",
  "Agente principal (Antigravity)": "Main agent (Antigravity)",
  "Subagente (Antigravity)": "Subagent (Antigravity)",
  "Antigravity: falha no ciclo de leitura: {0}": "Antigravity: poll cycle failed: {0}",
  "Processando no Antigravity": "Processing in Antigravity",
  "Sessão do Antigravity": "Antigravity session",
  "✓ Hooks do Habblaud instalados no Antigravity em {0}": "✓ Habblaud hooks installed in Antigravity at {0}",
  "Nenhum hooks.json encontrado em {0}": "No hooks.json found at {0}",
  "✓ Hooks do Habblaud removidos de {0}": "✓ Habblaud hooks removed from {0}",
  "Nenhum hook do Habblaud estava instalado em {0}": "No Habblaud hooks were installed in {0}",
  "✓ Antigravity: todos os hooks instalados em {0} ({1})": "✓ Antigravity: all hooks installed in {0} ({1})",
  "! Antigravity: faltando hooks em {0} ({1}); rode npm run antigravity:install":
    "! Antigravity: missing hooks in {0} ({1}); run npm run antigravity:install",
  "Antigravity {0} ({1}): monta {2} de {3}, somente leitura.":
    "Antigravity {0} ({1}): mounts {2} from {3}, read-only.",
  "Antigravity": "Antigravity",
  "O Antigravity se integra ao Habblaud via hooks e leitura de sessões: o uso de tokens e chamadas a ferramentas aparece nos detalhes de cada agente.":
    "Antigravity integrates with Habblaud via hooks and session reading: token counts and tool calls appear in each agent's details.",
  "Como o Antigravity se integra ao Habblaud (abre a ajuda em “Antigravity”)":
    "How Antigravity integrates with Habblaud (opens help in “Antigravity”)",
  "conectado via hooks": "connected via hooks",
  "conectado": "connected",
  "sessão ativa": "active session",
  "sessões ativas": "active sessions",
  "ativ.": "act.",
  "O Antigravity se integra ao Habblaud via hooks de ciclo de vida (`npm run antigravity:install`) e leitura direta de `conversation_summaries.db` e `transcript.jsonl`.":
    "Antigravity integrates with Habblaud via lifecycle hooks (`npm run antigravity:install`) and direct reading of `conversation_summaries.db` and `transcript.jsonl`.",
  "Cada projeto aberto no Antigravity vira uma sala no escritório; se o Claude Code ou o Codex estiverem no mesmo projeto, dividem a sala amigavelmente.":
    "Each project opened in Antigravity becomes a room in the office; if Claude Code or Codex are in the same project, they share the room.",
  "Os personagens do Antigravity exibem a cor violeta e o crachá AGY na mesa e no topo da gaveta de detalhes.":
    "Antigravity characters feature violet styling and the AGY badge on their desk and drawer header.",
  "Subagentes invocados (ex.: pesquisas e tarefas paralelas) chegam como colegas na sala do agente pai e se despedem ao concluir.":
    "Spawned subagents (e.g. research and parallel tasks) arrive as colleagues in the parent agent's room and leave when finished.",
  "Uso e tokens: o Antigravity não possui janelas de 5 horas como o Claude Code; as estatísticas de tokens de entrada e saída aparecem no painel de cada agente e na linha do tempo.":
    "Usage and tokens: Antigravity does not have 5-hour quota windows like Claude Code; input and output token statistics appear in each agent's panel and timeline.",
  "Mensagens e perguntas: as perguntas feitas pelo agente e mensagens enviadas pelo escritório são sincronizadas via hooks.":
    "Messages and questions: questions asked by the agent and messages sent from the office are synchronized via hooks.",
  " Conta do Antigravity (crachá AGY).": " Antigravity account (AGY badge).",
};

export const ES_ANTIGRAVITY: Readonly<Record<string, string>> = {
  "Para mandar mensagens ao Antigravity: rode npm run antigravity:install no computador":
    "Para enviar mensajes a Antigravity: ejecuta npm run antigravity:install en tu computadora",
  "eventos do Antigravity só são aceitos pelo próprio computador (http://localhost ou http://127.0.0.1)":
    "los eventos de Antigravity solo se aceptan desde esta computadora (http://localhost o http://127.0.0.1)",
  "Antigravity ({0})": "Antigravity ({0})",
  "Agente principal (Antigravity)": "Agente principal (Antigravity)",
  "Subagente (Antigravity)": "Subagente (Antigravity)",
  "Antigravity: falha no ciclo de leitura: {0}": "Antigravity: fallo en el ciclo de lectura: {0}",
  "Processando no Antigravity": "Procesando en Antigravity",
  "Sessão do Antigravity": "Sesión de Antigravity",
  "✓ Hooks do Habblaud instalados no Antigravity em {0}": "✓ Hooks de Habblaud instalados en Antigravity en {0}",
  "Nenhum hooks.json encontrado em {0}": "No se encontró hooks.json en {0}",
  "✓ Hooks do Habblaud removidos de {0}": "✓ Hooks de Habblaud eliminados de {0}",
  "Nenhum hook do Habblaud estava instalado em {0}": "No había ningún hook de Habblaud instalado en {0}",
  "✓ Antigravity: todos os hooks instalados em {0} ({1})": "✓ Antigravity: todos los hooks instalados en {0} ({1})",
  "! Antigravity: faltando hooks em {0} ({1}); rode npm run antigravity:install":
    "! Antigravity: faltan hooks en {0} ({1}); ejecuta npm run antigravity:install",
  "Antigravity {0} ({1}): monta {2} de {3}, somente leitura.":
    "Antigravity {0} ({1}): monta {2} de {3}, solo lectura.",
  "Antigravity": "Antigravity",
  "O Antigravity se integra ao Habblaud via hooks e leitura de sessões: o uso de tokens e chamadas a ferramentas aparece nos detalhes de cada agente.":
    "Antigravity se integra a Habblaud vía hooks y lectura de sesiones: el conteo de tokens y llamadas a herramientas aparece en los detalles de cada agente.",
  "Como o Antigravity se integra ao Habblaud (abre a ajuda em “Antigravity”)":
    "Cómo se integra Antigravity a Habblaud (abre la ayuda en “Antigravity”)",
  "conectado via hooks": "conectado por hooks",
  "conectado": "conectado",
  "sessão ativa": "sesión activa",
  "sessões ativas": "sesiones activas",
  "ativ.": "act.",
  "O Antigravity se integra ao Habblaud via hooks de ciclo de vida (`npm run antigravity:install`) e leitura direta de `conversation_summaries.db` e `transcript.jsonl`.":
    "Antigravity se integra a Habblaud vía hooks de ciclo de vida (`npm run antigravity:install`) y lectura directa de `conversation_summaries.db` y `transcript.jsonl`.",
  "Cada projeto aberto no Antigravity vira uma sala no escritório; se o Claude Code ou o Codex estiverem no mesmo projeto, dividem a sala amigavelmente.":
    "Cada proyecto abierto en Antigravity se convierte en una sala en la oficina; si Claude Code o Codex están en el mismo proyecto, comparten la sala.",
  "Os personagens do Antigravity exibem a cor violeta e o crachá AGY na mesa e no topo da gaveta de detalhes.":
    "Los personajes de Antigravity lucen color violeta y la insignia AGY en el escritorio y cabecera de detalles.",
  "Subagentes invocados (ex.: pesquisas e tarefas paralelas) chegam como colegas na sala do agente pai e se despedem ao concluir.":
    "Los subagentes invocados (ej. investigaciones y tareas paralelas) llegan como compañeros a la sala del agente principal y se marchan al terminar.",
  "Uso e tokens: o Antigravity não possui janelas de 5 horas como o Claude Code; as estatísticas de tokens de entrada e saída aparecem no painel de cada agente e na linha do tempo.":
    "Uso y tokens: Antigravity no tiene ventanas de cuota de 5 horas como Claude Code; las estadísticas de tokens de entrada y salida aparecen en el panel de cada agente y en la línea de tiempo.",
  "Mensagens e perguntas: as perguntas feitas pelo agente e mensagens enviadas pelo escritório são sincronizadas via hooks.":
    "Mensajes y preguntas: las preguntas formuladas por el agente y los mensajes enviados desde la oficina se sincronizan mediante hooks.",
  " Conta do Antigravity (crachá AGY).": " Cuenta de Antigravity (insignia AGY).",
};

export const FR_ANTIGRAVITY: Readonly<Record<string, string>> = {
  "Para mandar mensagens ao Antigravity: rode npm run antigravity:install no computador":
    "Pour envoyer des messages à Antigravity : lancez npm run antigravity:install sur votre ordinateur",
  "eventos do Antigravity só são aceitos pelo próprio computador (http://localhost ou http://127.0.0.1)":
    "les événements Antigravity ne sont acceptés que depuis cet ordinateur (http://localhost ou http://127.0.0.1)",
  "Antigravity ({0})": "Antigravity ({0})",
  "Agente principal (Antigravity)": "Agent principal (Antigravity)",
  "Subagente (Antigravity)": "Sous-agent (Antigravity)",
  "Antigravity: falha no ciclo de leitura: {0}": "Antigravity : échec du cycle de lecture : {0}",
  "Processando no Antigravity": "Traitement dans Antigravity",
  "Sessão do Antigravity": "Session Antigravity",
  "✓ Hooks do Habblaud instalados no Antigravity em {0}": "✓ Hooks Habblaud installés dans Antigravity dans {0}",
  "Nenhum hooks.json encontrado em {0}": "Aucun hooks.json trouvé dans {0}",
  "✓ Hooks do Habblaud removidos de {0}": "✓ Hooks Habblaud retirés de {0}",
  "Nenhum hook do Habblaud estava instalado em {0}": "Aucun hook Habblaud n'était installé dans {0}",
  "✓ Antigravity: todos os hooks instalados em {0} ({1})": "✓ Antigravity : tous les hooks installés dans {0} ({1})",
  "! Antigravity: faltando hooks em {0} ({1}); rode npm run antigravity:install":
    "! Antigravity : hooks manquants dans {0} ({1}) ; lancez npm run antigravity:install",
  "Antigravity {0} ({1}): monta {2} de {3}, somente leitura.":
    "Antigravity {0} ({1}) : monte {2} depuis {3}, en lecture seule.",
  "Antigravity": "Antigravity",
  "O Antigravity se integra ao Habblaud via hooks e leitura de sessões: o uso de tokens e chamadas a ferramentas aparece nos detalhes de cada agente.":
    "Antigravity s'intègre à Habblaud via des hooks et la lecture des sessions : les décomptes de jetons et les appels d'outils apparaissent dans les détails de chaque agent.",
  "Como o Antigravity se integra ao Habblaud (abre a ajuda em “Antigravity”)":
    "Comment Antigravity s'intègre à Habblaud (ouvre l'aide dans « Antigravity »)",
  "conectado via hooks": "connecté via hooks",
  "conectado": "connecté",
  "sessão ativa": "session active",
  "sessões ativas": "sessions actives",
  "ativ.": "act.",
  "O Antigravity se integra ao Habblaud via hooks de ciclo de vida (`npm run antigravity:install`) e leitura direta de `conversation_summaries.db` e `transcript.jsonl`.":
    "Antigravity s'intègre à Habblaud via des hooks de cycle de vie (`npm run antigravity:install`) et la lecture directe de `conversation_summaries.db` et `transcript.jsonl`.",
  "Cada projeto aberto no Antigravity vira uma sala no escritório; se o Claude Code ou o Codex estiverem no mesmo projeto, dividem a sala amigavelmente.":
    "Chaque projet ouvert dans Antigravity devient une pièce dans le bureau ; si Claude Code ou Codex sont dans le même projet, ils partagent la pièce.",
  "Os personagens do Antigravity exibem a cor violeta e o crachá AGY na mesa e no topo da gaveta de detalhes.":
    "Les personnages Antigravity arborent la couleur violette et le badge AGY sur leur bureau et l'en-tête du tiroir.",
  "Subagentes invocados (ex.: pesquisas e tarefas paralelas) chegam como colegas na sala do agente pai e se despedem ao concluir.":
    "Les sous-agents invoqués (ex. recherches et tâches parallèles) arrivent comme collègues dans la pièce de l'agent parent et partent une fois terminés.",
  "Uso e tokens: o Antigravity não possui janelas de 5 horas como o Claude Code; as estatísticas de tokens de entrada e saída aparecem no painel de cada agente e na linha do tempo.":
    "Utilisation et jetons : Antigravity n'a pas de fenêtre de quota de 5 heures comme Claude Code ; les statistiques de jetons d'entrée et de sortie apparaissent dans le panneau de chaque agent et sur la chronologie.",
  "Mensagens e perguntas: as perguntas feitas pelo agente e mensagens enviadas pelo escritório são sincronizadas via hooks.":
    "Messages et questions : les questions posées par l'agent et les messages envoyés depuis le bureau sont synchronisés via des hooks.",
  " Conta do Antigravity (crachá AGY).": " Compte Antigravity (badge AGY).",
};
