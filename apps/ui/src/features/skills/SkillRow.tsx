import { Ellipsis, ListChecks, Trash2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import { relativeTime } from '@/lib/format'
import type { InstalledSkill, SkillEntry } from '@/lib/types'
import { IconButton } from '@/components/ui/button'
import { Badge } from '@/components/ui/chips'
import { Switch } from '@/components/ui/fields'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/overlays'
import { DrawnCheck } from '@/features/settings/shared'
import { SkillTile } from './SkillParts'

/** A skill the AI has: one that came with AIOS, one added from the list, or one added from a file. */
export interface OwnedSkill {
  entry: SkillEntry
  /** Missing for the skills that come with AIOS. */
  installed?: InstalledSkill
  /** Added from a file of the person's own. */
  own?: boolean
}

/**
 * One line of "Your AI can already". Skills that come with AIOS say so and
 * have no controls. Added skills can be switched off, looked into and removed.
 */
export function SkillRow({ skill, justAdded, onToggle, onView, onRemove }: { skill: OwnedSkill; /** It arrived while this page was open. */ justAdded: boolean; onToggle: (enabled: boolean) => void; onView: () => void; onRemove: () => void }) {
  const { entry, installed, own } = skill
  const off = !!installed && !installed.enabled

  return (
    <div className="flex items-center gap-3.5 px-5 py-3.5">
      <SkillTile id={entry.id} category={entry.category} dimmed={off} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
          <h3 className={cn('text-base font-semibold transition-colors duration-(--duration-panel)', off ? 'text-ink-soft' : 'text-ink')}>{entry.name}</h3>
          {off && <Badge className="animate-fade">Off</Badge>}
        </div>
        <p className="mt-0.5 text-sm leading-5 text-ink-soft">{entry.line}</p>
      </div>

      {!installed ? (
        <span className="shrink-0 text-xs leading-4.5 text-ink-50">Included with AIOS</span>
      ) : (
        <div className="flex shrink-0 items-center gap-3">
          {justAdded ? (
            <span className="hidden items-center gap-1.5 text-xs font-medium leading-4.5 text-green sm:flex">
              <DrawnCheck className="size-3.5" />
              {own ? 'Added by you' : 'Added'}
            </span>
          ) : (
            <span className="hidden max-w-56 truncate text-xs leading-4.5 text-ink-50 md:block">{own ? `Added by you ${relativeTime(installed.installed_at)}` : `${entry.publisher} · added ${relativeTime(installed.installed_at)}`}</span>
          )}
          <Switch checked={installed.enabled} onCheckedChange={onToggle} aria-label={`Use ${entry.name}`} />
          <Menu>
            <MenuTrigger asChild>
              <IconButton label={`More for ${entry.name}`} size="sm">
                <Ellipsis />
              </IconButton>
            </MenuTrigger>
            <MenuContent>
              <MenuItem icon={<ListChecks />} onSelect={onView}>
                What it can use
              </MenuItem>
              <MenuSeparator />
              <MenuItem destructive icon={<Trash2 />} onSelect={onRemove}>
                Remove skill
              </MenuItem>
            </MenuContent>
          </Menu>
        </div>
      )}
    </div>
  )
}
