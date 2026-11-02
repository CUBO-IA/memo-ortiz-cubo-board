#!/usr/bin/env bash
# Instalador de CUBO Board para macOS y Linux. Hace todo lo que se puede hacer
# solo; lo único que te pide es lo que pasa dentro de tu cuenta de Google.
#
#   git clone https://github.com/CUBO-IA/memo-ortiz-cubo-board.git && cd memo-ortiz-cubo-board && ./instalar.sh
set -euo pipefail
cd "$(dirname "$0")"
RAIZ="$(pwd)"
PUERTO="${PORT:-8790}"

paso() { printf "\n\033[1m› %s\033[0m\n" "$1"; }
ok()   { printf "  ✓ %s\n" "$1"; }
falta(){ printf "  ✗ %s\n" "$1"; }
abrir(){ if command -v open >/dev/null; then open "$1"; elif command -v xdg-open >/dev/null; then xdg-open "$1"; else echo "  → $1"; fi; }

printf "\n\033[1m CUBO Board\033[0m — Poné tus apuntes. El tablero se ordena solo.\n"

# 1. Node
paso "Node.js"
if command -v node >/dev/null && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ]; then
  ok "Node $(node -v)"
else
  falta "Hace falta Node 22 o más nuevo."
  if command -v brew >/dev/null; then echo "  Instalando con Homebrew…"; brew install node; else
    echo "  Instalalo desde https://nodejs.org (versión LTS) y volvé a correr ./instalar.sh"; abrir "https://nodejs.org"; exit 1; fi
fi

# 2. pdftotext (para leer PDF)
paso "pdftotext"
if command -v pdftotext >/dev/null; then ok "pdftotext"; else
  if command -v brew >/dev/null; then echo "  Instalando poppler con Homebrew…"; brew install poppler; else
    falta "Instalá poppler (trae pdftotext): en Debian/Ubuntu, sudo apt install poppler-utils. Sin esto, los PDF no se leen."; fi
fi

# 3. Claude Code
paso "Claude Code"
if ! command -v claude >/dev/null; then
  echo "  No está instalado. Instalando con el instalador oficial de Anthropic…"
  curl -fsSL https://claude.ai/install.sh | bash
  export PATH="$HOME/.local/bin:$PATH"
fi
command -v claude >/dev/null && ok "Claude Code $(claude --version 2>/dev/null | head -1)" || { falta "No encontré 'claude' después de instalar. Cerrá y abrí la terminal y volvé a correr ./instalar.sh"; exit 1; }
if ! claude auth status >/dev/null 2>&1; then
  echo "  Iniciá sesión con tu cuenta de Claude (se abre el navegador)…"
  claude auth login
fi
ok "sesión de Claude iniciada"

# 4. Dependencias y carpeta confiable
paso "Proyecto"
npm install --silent
ok "dependencias instaladas"
node - <<'EOF'
const fs = require("fs"), os = require("os"), path = require("path");
const archivo = path.join(os.homedir(), ".claude.json");
let cfg = {}; try { cfg = JSON.parse(fs.readFileSync(archivo, "utf8")); } catch {}
cfg.projects ??= {}; cfg.projects[process.cwd()] ??= {}; cfg.projects[process.cwd()].hasTrustDialogAccepted = true;
fs.writeFileSync(archivo, JSON.stringify(cfg, null, 2));
EOF
ok "carpeta marcada como confiable para Claude Code"
[ -f .env ] || cp .env.example .env
mkdir -p data logs

# 5. Google: Drive y Calendar conectados a Claude
paso "Google Drive y Google Calendar"
if claude mcp list 2>/dev/null | grep -q "Google Drive.*Connected" && claude mcp list 2>/dev/null | grep -q "Google Calendar.*Connected"; then
  ok "ya están conectados"
else
  cat <<'PASOS'
  Esto pasa dentro de tu cuenta de Google, así que lo hacés vos. Se abre claude.ai en la página de conectores:
    1) Buscá "Google Drive" en la lista y hacé clic en "Conectar".
    2) Elegí la cuenta de Google donde querés guardar tus clases y apretá "Permitir".
    3) Buscá "Google Calendar", "Conectar", la MISMA cuenta, "Permitir".
    4) Volvé a esta terminal y apretá Enter.
PASOS
  abrir "https://claude.ai/settings/connectors"
  read -r -p "  Enter cuando los dos digan \"Conectado\"… " _
  if claude mcp list 2>/dev/null | grep -q "Google Drive.*Connected" && claude mcp list 2>/dev/null | grep -q "Google Calendar.*Connected"; then ok "conectados"; else
    falta "Todavía no los veo conectados. Podés seguir y volver a correr ./instalar.sh después."; fi
fi

# 6. Carpeta de Drive: la crea el agente solo
paso "Carpeta CUBO Board en Drive"
if grep -q "^CARPETA_DRIVE_ID=.\+" .env; then ok "ya configurada"; else
  rm -f data/drive/raiz.json
  MODO=instalacion claude -p "Creá en la raíz de Google Drive una carpeta llamada exactamente \"CUBO Board\" con create_file (mimeType application/vnd.google-apps.folder, sin parentId). No hagas nada más." \
    --permission-mode dontAsk --max-turns 6 --output-format json --model sonnet >/dev/null 2>&1 || true
  ID="$(node -p 'try{require("./data/drive/raiz.json").id}catch{""}')"
  if [ -n "$ID" ]; then
    sed -i.bak "s|^CARPETA_DRIVE_ID=.*|CARPETA_DRIVE_ID=$ID|" .env && rm -f .env.bak
    ok "carpeta creada y guardada"
  else
    falta "No pude crear la carpeta. Creá una carpeta \"CUBO Board\" en Drive y pegá el ID (lo que va después de folders/ en la URL):"
    read -r -p "  ID de la carpeta: " ID; sed -i.bak "s|^CARPETA_DRIVE_ID=.*|CARPETA_DRIVE_ID=$ID|" .env && rm -f .env.bak
  fi
fi

# 7. Calendario: Google no deja crearlo desde afuera, así que lo hacés vos
paso "Calendario CUBO Board"
if grep -q "^CALENDARIO_ID=.\+" .env; then ok "ya configurado"; else
  cat <<'PASOS'
  Google no permite crear calendarios desde afuera, así que este lo creás vos. Se abre Google Calendar en "Crear calendario":
    1) En "Nombre" escribí: CUBO Board   (la descripción puede quedar vacía).
    2) Apretá "Crear calendario" y esperá unos segundos.
    3) A la izquierda, en "Configuración de mis calendarios", hacé clic en "CUBO Board".
    4) Bajá hasta "Integrar calendario" y copiá el "ID del calendario".
       Es largo y termina en @group.calendar.google.com.
    5) Pegalo aquí y apretá Enter.
PASOS
  abrir "https://calendar.google.com/calendar/u/0/r/settings/createcalendar"
  read -r -p "  ID del calendario: " ID
  sed -i.bak "s|^CALENDARIO_ID=.*|CALENDARIO_ID=$ID|" .env && rm -f .env.bak
  ok "calendario guardado"
fi
if ! grep -q "^CALENDARIO_CLASES_ID=.\+" .env; then
  echo "  Opcional: si tu escuela comparte un calendario con las clases, el agente puede leerlo para saber qué clase viene."
  echo "  Está en la misma configuración, bajo \"Configuración de otros calendarios\" → el calendario → \"Integrar calendario\" → \"ID del calendario\"."
  read -r -p "  ID del calendario de clases (Enter para saltar): " ID
  [ -n "$ID" ] && sed -i.bak "s|^CALENDARIO_CLASES_ID=.*|CALENDARIO_CLASES_ID=$ID|" .env && rm -f .env.bak
fi

# 8. Arrancar
paso "Listo"
echo "  CUBO Board corre en  http://127.0.0.1:$PUERTO"
echo "  Para abrirlo otro día:  cd \"$RAIZ\" && npm start"
sleep 1; abrir "http://127.0.0.1:$PUERTO"
exec npm start
