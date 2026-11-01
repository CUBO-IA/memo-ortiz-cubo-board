# Origen de esta skill

- **Fuente:** repositorio público de skills de Anthropic, https://github.com/anthropics/skills (carpeta `skills/pdf`), commit `ca45fc4` del 28 de octubre de 2026.
- **Por qué esta:** CUBO Board necesita leer las diapositivas en PDF que sube el estudiante. Es la skill oficial de Anthropic para PDF y la más usada.
- **Revisión antes de instalar (1 de noviembre de 2026):**
  - `SKILL.md` solo da instrucciones para usar `pypdf`, `pdfplumber`, `pdftotext` y `qpdf`. No pide instalar nada por su cuenta ni conectarse a internet.
  - Los ocho scripts de `scripts/` son para formularios PDF. Ninguno importa `requests`, `urllib`, `socket` ni `subprocess`. **No los copiamos**, porque CUBO Board no llena formularios: menos código, menos superficie de ataque.
  - `forms.md` tampoco se copió por la misma razón.
- **Cómo la usa el agente:** solo para extraer texto con `pdftotext`. El guardia (`agent/guardia.js`) bloquea cualquier otro comando.
