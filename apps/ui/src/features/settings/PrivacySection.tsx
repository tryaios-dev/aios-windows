import { useMemo, type ReactNode } from 'react'
import { Link } from 'react-router'
import { KeyRound } from 'lucide-react'
import { ART } from '@/assets/icons'
import { ArtTile } from '@/components/ui/art'
import { cn } from '@/lib/cn'
import { selectAllowlist, useStore, useStoreShallow } from '@/lib/store'
import { useExtras } from '@/lib/extras'
import type { AllowlistEntry, Settings } from '@/lib/types'
import { CATALOGUE } from '@/data/catalogue'
import { BUILT_IN_RULES } from '@/data/stack'
import { Badge, StatusDot } from '@/components/ui/chips'
import { Ledger, NumberedList, PanelNote, PathValue, SettingGroup, SettingPanel } from './SettingRow'
import { Advanced } from './shared'
import { platform } from '@/lib/platform'

const LIMITS = [
  `A harmful program running under your ${platform.account} can read what you can read, including your conversations. AIOS cannot stop it.`,
  `If this computer is lost or stolen, your conversations are only as safe as your ${platform.signIn}. Turn on ${platform.diskEncryption} in ${platform.os} to protect the whole disk.`,
  'The activity record is kept only on this computer and is not independently certified. Someone in full control of this computer could replace it.',
]

/**
 * Where AI model files come from: the publisher's own address, read from the catalogue.
 * AIOS does not host AI models; it downloads each one directly from its publisher and checks it.
 */
function publisherHosts(): string[] {
  return [
    ...new Set(
      CATALOGUE.map((e) => {
        try {
          return new URL(e.mirror_url).host
        } catch {
          return ''
        }
      }).filter(Boolean),
    ),
  ]
}

/** One line of "Connections AIOS can make": what it is for, where it goes, when it happens, and how it stands. */
interface Connection {
  id: string
  what: string
  /** A second line under "what", for a resource: what kind of thing it is. */
  whatDetail?: string
  address: string
  /** A second line under the address, for a resource: where the provider runs it. */
  addressDetail?: string
  /** A web address is set in mono; a provider's name is not. */
  addressIsHost: boolean
  when: string
  status: string
  on: boolean
}

/** What each built-in connection is for and when it happens, in plain words. */
function describe(entry: AllowlistEntry, settings: Settings, publishers: string[]): { what: string; whatDetail?: string; when: string } {
  if (entry.host.startsWith('updates.')) {
    // The two daily checks in General: for a new version of AIOS, and for newly listed AI models.
    const daily = settings.update_check || settings.catalogue_check
    return { what: 'Checking for updates and downloading them', whatDetail: 'AIOS itself, and its list of AI models', when: daily ? 'When AIOS starts, and at most once a day.' : 'Only when you press Check now.' }
  }
  if (publishers.includes(entry.host)) {
    return { what: 'Downloading an AI model you install', whatDetail: 'Directly from its publisher', when: 'Only when you install an AI model or update one. AIOS checks it before using it.' }
  }
  if (entry.kind === 'configured') return { what: 'Your company server', when: 'Only while a conversation you chose to run there is being answered.' }
  return { what: entry.purpose, when: 'When needed.' }
}

/** Privacy and connections: the promise, the four rules, everything AIOS connects to and when, and the limits. */
export function PrivacySection() {
  const allowlist = useStoreShallow(selectAllowlist)
  const settings = useStore((s) => s.settings)
  const companyFlag = useStore((s) => s.health.company.enabled)
  const company = useStore((s) => s.health.company)
  // Linked resources: none until the backend has resources (proposed: GET /resources).
  const linked = useExtras((s) => s.linkedResources)

  const connections = useMemo<Connection[]>(() => {
    const rows: Connection[] = []
    // Read when the page opens: the catalogue comes from the backend after this module loads.
    const publishers = publisherHosts()
    const builtIn = (e: AllowlistEntry): Connection => ({ id: e.host, ...describe(e, settings, publishers), address: e.host, addressIsHost: true, status: e.enabled ? 'On' : 'Off', on: e.enabled })
    // Updates first, then where AI models come from.
    const fixed = allowlist.filter((e) => e.kind === 'fixed')
    rows.push(...fixed.filter((e) => e.host.startsWith('updates.')).map(builtIn))
    rows.push(...fixed.filter((e) => !e.host.startsWith('updates.')).map(builtIn))
    // A publisher named in the catalogue is always shown, whether or not the built-in list names it yet.
    for (const host of publishers) {
      if (fixed.some((e) => e.host === host)) continue
      rows.push(builtIn({ host, purpose: '', kind: 'fixed', enabled: true }))
    }
    // The company server is lab-only in this version: it is listed only where it is switched on.
    rows.push(...allowlist.filter((e) => e.kind === 'configured' && e.enabled).map(builtIn))
    return rows
  }, [allowlist, settings])

  return (
    <>
      <section aria-labelledby="privacy-promise" className="overflow-hidden rounded-xl border border-line bg-white shadow-card">
        <div className="flex items-start gap-4 p-6">
          <ArtTile src={ART.encrypted} size="xl" />
          <div className="min-w-0 flex-1">
            <div className="label-mono">The promise</div>
            <h3 id="privacy-promise" className="mt-1.5 text-2xl font-semibold leading-8 tracking-[-0.01em] text-ink">
              Nothing leaves this computer unless you say so.
            </h3>
            <p className="mt-1.5 max-w-2xl text-sm leading-5 text-ink-soft">
              AIOS goes online only to check for updates and to download an AI model you install. An AI model is downloaded directly from its publisher, and AIOS checks it before using it. Anything sent to a resource you have linked needs your say-so each time, and appears in Activity.
            </p>
          </div>
        </div>
        <div className="flex items-start gap-3 border-t border-line-soft bg-paper-raised px-6 py-3">
          <KeyRound className="mt-0.5 size-4 shrink-0 text-ink-50" strokeWidth={1.75} aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-sm leading-5 text-ink">Everything AIOS keeps on this computer is encrypted. The activity record holds no conversation content.</p>
            <p className="mt-0.5 text-xs leading-4.5 text-ink-50">The key is kept by {platform.os} for your account. The originals of documents you add are not changed, so they are not encrypted by AIOS.</p>
          </div>
        </div>
      </section>

      <SettingGroup title="The four built-in rules" description="What the AI may and may not do.">
        <SettingPanel>
          <NumberedList items={BUILT_IN_RULES.map((rule) => ({ title: rule }))} />
          <PanelNote>Enforced by AIOS in this version. Your own rules come later.</PanelNote>
        </SettingPanel>
      </SettingGroup>

      <SettingGroup title="Connections AIOS can make" description="Everything AIOS connects to, what each one is for, and when it happens.">
        <SettingPanel>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line-soft bg-paper-raised">
                  <Th className="pl-5">What it is for</Th>
                  <Th>Address</Th>
                  <Th>When it connects</Th>
                  <Th className="pr-5">Status</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {connections.map((c) => (
                  <tr key={c.id} className="align-top">
                    <th scope="row" className="min-w-40 py-3.5 pl-5 pr-4 text-left font-medium leading-5 text-ink">
                      {c.what}
                      {c.whatDetail && <span className="mt-0.5 block text-xs font-normal leading-4.5 text-ink-50">{c.whatDetail}</span>}
                    </th>
                    <td className="py-3.5 pr-4">
                      {c.addressIsHost ? <span className="whitespace-nowrap font-mono text-xs leading-5 tracking-[0.02em] text-ink-soft">{c.address}</span> : <span className="whitespace-nowrap leading-5 text-ink-soft">{c.address}</span>}
                      {c.addressDetail && <span className="mt-0.5 block whitespace-nowrap text-xs leading-4.5 text-ink-50">{c.addressDetail}</span>}
                    </td>
                    <td className="min-w-44 py-3.5 pr-4 leading-5 text-ink-soft">{c.when}</td>
                    <td className="py-3.5 pr-5">
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap leading-5 text-ink-soft">
                        <StatusDot tone={c.on ? 'green' : 'neutral'} />
                        {c.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <PanelNote>
            AIOS makes no other connections. You can turn the daily checks off in{' '}
            <Link to="/settings/general" className="font-medium text-green hover:underline">
              General
            </Link>
            .{' '}
            {linked.length > 0 ? (
              'Linking a resource sent nothing. Unlink one and it leaves this list.'
            ) : (
              <>
                If you link a resource in{' '}
                <Link to="/resources" className="font-medium text-green hover:underline">
                  Add resources to my AI
                </Link>
                , it is listed here, and it is used only when you allow a send.
              </>
            )}
          </PanelNote>
        </SettingPanel>
      </SettingGroup>

      {companyFlag && (
        <SettingGroup title="Company server" description="Set up by your organisation. A conversation goes there only when you choose it, and AIOS asks first.">
          <SettingPanel>
            <Ledger
              rows={[
                { k: 'Address', v: <PathValue value={company.base_url} /> },
                { k: 'AI model', v: company.model_name },
                {
                  k: 'Right now',
                  v: (
                    <span className="inline-flex items-center gap-1.5 text-ink-soft">
                      <StatusDot tone={company.reachable ? 'green' : 'deny'} />
                      {company.reachable ? 'AIOS can reach it' : 'AIOS cannot reach it'}
                    </span>
                  ),
                },
              ]}
            />
          </SettingPanel>
        </SettingGroup>
      )}

      <SettingGroup title="What AIOS cannot protect you from" description="Three limits worth knowing.">
        <SettingPanel>
          <NumberedList items={LIMITS.map((text) => ({ title: <span className="font-normal text-ink-soft">{text}</span> }))} />
        </SettingPanel>
      </SettingGroup>

      <Advanced summary="How the rules are enforced, and the schedule">
        <SettingGroup title="Enforcement">
          <SettingPanel>
            <Ledger
              cols="grid-cols-[minmax(180px,38%)_1fr]"
              rows={allowlist.map((e) => ({
                rawKey: true,
                k: <span className="font-mono text-xs font-normal tracking-[0.02em]">{e.host}</span>,
                v: (
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge tone={e.kind === 'fixed' ? 'neutral' : 'slate'}>{e.kind === 'fixed' ? 'Fixed in build' : 'Configured by an operator'}</Badge>
                    <Badge tone={e.enabled ? 'green' : 'neutral'}>{e.enabled ? 'Enabled' : 'Disabled'}</Badge>
                  </span>
                ),
                hint: e.purpose,
              })).concat(
                publisherHosts().filter((host) => !allowlist.some((e) => e.host === host)).map((host) => ({
                  rawKey: true,
                  k: <span className="font-mono text-xs font-normal tracking-[0.02em]">{host}</span>,
                  v: (
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge tone="neutral">From the signed catalogue</Badge>
                      <Badge tone="green">Enabled</Badge>
                    </span>
                  ),
                  hint: 'AI model downloads the user starts. The artefact digest is verified before the file is used.',
                })),
              )}
            />
            <PanelNote>The allowlist is enforced by the application, not by the operating system, in this version.</PanelNote>
          </SettingPanel>
        </SettingGroup>
        <SettingGroup title="Schedule">
          <SettingPanel>
            <Ledger
              rows={[
                { k: 'Update feed', v: <Schedule on={settings.update_check}>At start and at most once a day</Schedule> },
                { k: 'Model catalogue', v: <Schedule on={settings.catalogue_check}>At start and at most once a day</Schedule> },
                { k: 'Model downloads', v: 'Only when started from AI models, from the publisher host in the catalogue entry. A download resumes where it stopped.' },
                ...(linked.length > 0 ? [{ k: 'Linked resources', v: 'Only after an “Allow once” confirmation. Each send is recorded as a disclosure event.' }] : []),
                ...(companyFlag ? [{ k: 'Company AI server', v: 'Only while a conversation runs on the company provider.' }] : []),
              ]}
            />
          </SettingPanel>
        </SettingGroup>
      </Advanced>
    </>
  )
}

function Th({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <th scope="col" className={cn('label-mono h-9 pr-4 text-left font-normal', className)}>
      {children}
    </th>
  )
}

function Schedule({ on, children }: { on: boolean; children: ReactNode }) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span>{children}</span>
      <Badge tone={on ? 'green' : 'neutral'}>{on ? 'On' : 'Off'}</Badge>
    </span>
  )
}
