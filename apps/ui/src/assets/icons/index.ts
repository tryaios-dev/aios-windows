/**
 * Colour icons used across the app, and the logos of the AI models and
 * computing providers. All are local files, so the app shows them with no
 * internet connection.
 *
 * Rule of thumb: a colour icon stands for a thing (a page, a document, a
 * skill, a part of AIOS), and each thing has the same icon everywhere, from
 * the left-hand menu to its own page. Buttons and small controls keep plain
 * line icons, so colour always means "this is something you have".
 *
 * Sources and licences:
 *   ./*.svg        Fluent UI System Icons, colour set, by Microsoft (MIT).
 *   ../brands/*.svg  Lobe Icons static SVG set (MIT). The logos themselves
 *                  are trade marks of their owners. They are used here to
 *                  identify the products in a design mock-up; shipping them
 *                  needs each owner's brand terms and, for resources, a
 *                  reseller agreement.
 */
import bookOpenLightbulb from './book-open-lightbulb.svg'
import chartMultiple from './chart-multiple.svg'
import clipboardTask from './clipboard-task.svg'
import cloud from './cloud.svg'
import codeBlock from './code-block.svg'
import dataBar from './data-bar-vertical-ascending.svg'
import documentEdit from './document-edit.svg'
import documentFolder from './document-folder.svg'
import documentText from './document-text.svg'
import edit from './edit.svg'
import globe from './globe.svg'
import image from './image.svg'
import laptop from './laptop.svg'
import library from './library.svg'
import mic from './mic.svg'
import peopleChat from './people-chat.svg'
import puzzlePiece from './puzzle-piece.svg'
import receipt from './receipt.svg'
import table from './table.svg'
import video from './video.svg'
import arrowSquareDown from './arrow-square-down.svg'
import arrowSync from './arrow-sync.svg'
import botSparkle from './bot-sparkle.svg'
import calendarCheckmark from './calendar-checkmark.svg'
import certificate from './certificate.svg'
import chat from './chat.svg'
import checkmarkCircle from './checkmark-circle.svg'
import documentAdd from './document-add.svg'
import documentPlain from './document.svg'
import gauge from './gauge.svg'
import globeShield from './globe-shield.svg'
import history from './history.svg'
import home from './home.svg'
import lightbulb from './lightbulb.svg'
import lockClosed from './lock-closed.svg'
import lockShield from './lock-shield.svg'
import mail from './mail.svg'
import personKey from './person-key.svg'
import send from './send.svg'
import settings from './settings.svg'
import shield from './shield.svg'
import shieldCheckmark from './shield-checkmark.svg'
import textBulletList from './text-bullet-list-square.svg'
import vault from './vault.svg'
import warning from './warning.svg'
import wrenchScrewdriver from './wrench-screwdriver.svg'
import gemma from '../brands/gemma.svg'
import qwen from '../brands/qwen.svg'
import deepseek from '../brands/deepseek.svg'
import gemini from '../brands/gemini.svg'
import hunyuan from '../brands/hunyuan.svg'
import kimi from '../brands/kimi.svg'
import nvidia from '../brands/nvidia.svg'

/** One icon per skill, by skill id. */
export const SKILL_ICON: Record<string, string> = {
  write: documentEdit,
  'read-documents': library,
  minutes: peopleChat,
  spreadsheets: table,
  contracts: clipboardTask,
  translate: globe,
  voice: mic,
  charts: chartMultiple,
  'own-invoice-reader': receipt,
}

/** Used when a skill has no icon of its own. */
export const SKILL_CATEGORY_ICON: Record<string, string> = {
  Writing: edit,
  Documents: documentText,
  Numbers: dataBar,
  Voice: mic,
  Languages: globe,
  Images: image,
}

export const OWN_SKILL_ICON = puzzlePiece

/** One icon per task in "What do you want to do?", by task id. */
export const TASK_ICON: Record<string, string> = {
  write: edit,
  documents: documentFolder,
  video,
  images: image,
  research: bookOpenLightbulb,
  code: codeBlock,
}

/** The logo of the product behind each resource, by resource id. */
export const RESOURCE_LOGO: Record<string, string> = {
  'deepseek-v4': deepseek,
  'gemini-3-pro': gemini,
  'kimi-k2': kimi,
  'hunyuan-video': hunyuan,
  'gpu-4090': nvidia,
  'gpu-h100': nvidia,
}

/** Used when a resource has no logo of its own. */
export const RESOURCE_KIND_ICON: Record<string, string> = { model: cloud, compute: laptop }

/**
 * Named icons for the parts of AIOS and the things on its pages. Use these
 * names, not file names, so one thing has one icon everywhere.
 */
export const ART = {
  knowledge: library,
  model: botSparkle,
  skills: puzzlePiece,
  resources: cloud,
  activity: history,
  backup: shieldCheckmark,
  backupMissing: shield,
  vault,
  speed: gauge,
  conversation: chat,
  lock: lockClosed,
  encrypted: lockShield,
  addDocument: documentAdd,
  document: documentPlain,
  folder: documentFolder,
  settings,
  privacy: globeShield,
  computer: laptop,
  troubleshooting: wrenchScrewdriver,
  about: certificate,
  update: arrowSync,
  download: arrowSquareDown,
  warning,
  recoveryKey: personKey,
  done: checkmarkCircle,
  voice: mic,
  sent: send,
  home,
} as const

/** One icon per ready-made request, by starter id. */
export const STARTER_ART: Record<string, string> = {
  email: mail,
  summarise: textBulletList,
  explain: lightbulb,
  plan: calendarCheckmark,
}

/** The logo of the family an AI model belongs to, from its name. Falls back to the AI model icon. */
export function modelLogo(name: string | null | undefined): string {
  const n = (name ?? '').toLowerCase()
  if (n.includes('qwen')) return qwen
  if (n.includes('gemma')) return gemma
  return botSparkle
}
