import { watchFile, unwatchFile } from 'fs'
import chalk from 'chalk'
import { fileURLToPath } from 'url'

// CONFIGURACIÓN BÁSICA PARA BOT DE WHATSAPP
// ==========================================
// global.owner - Números de los dueños del bot
//   - Primer array: número principal (owner real)
//   - Segundo array: número lid
//   - Formato: ['número'] (con código de país)
//   - Ejemplo: ['5211234567890']
//
// global.dev - Tu nombre o alias
//   - Aparecerá en el menú y respuestas
//
// global.botName - Nombre de tu bot
//   - Aparecerá en mensajes y logs
//
// global.prefix - Prefijos para comandos
//   - Array con uno o más prefijos
//   - Ejemplo: ['.'] o ['!', '/']
//
// global.banner - URL de imagen para el menú
//   - Debe ser enlace directo a imagen

// By - CORVETTE SCRIPT
// ==========================================

global.owner = [
  ['1234567890'], // Número principal (owner real)
  ['0987654321']  // Número lid
]

global.dev = 'Nombre' // Tu nombre o alias
global.botName = 'Bot' // Nombre de tu bot
global.prefix = ['.'] // Prefijo por defecto (usa .)
global.banner = 'https://files.catbox.moe/u2viza.jpg' // Banner del menu 

// FUNCIÓN DE RECARGA AUTOMÁTICA
const file = fileURLToPath(import.meta.url)
watchFile(file, () => {
  unwatchFile(file)
  console.log(chalk.cyan("Configuración actualizada"))
  import(`${file}?update=${Date.now()}`)
})