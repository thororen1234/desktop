import * as React from 'react'

import { commitGrammar, RepositoryListItem } from './repository-list-item'
import {
  groupRepositories,
  RepositoryListRow,
  Repositoryish,
  RepositoryListGroup,
  getGroupKey,
} from './group-repositories'
import { IFilterListGroup } from '../lib/filter-list'
import { IMatches } from '../../lib/fuzzy-find'
import { ILocalRepositoryState, Repository } from '../../models/repository'
import { Dispatcher } from '../dispatcher'
import { Button } from '../lib/button'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { showContextualMenu } from '../../lib/menu-item'
import { IMenuItem } from '../../lib/menu-item'
import { PopupType } from '../../models/popup'
import { encodePathAsUrl } from '../../lib/path'
import { TooltippedContent } from '../lib/tooltipped-content'
import memoizeOne from 'memoize-one'
import { KeyboardShortcut } from '../keyboard-shortcut/keyboard-shortcut'
import { generateRepositoryListContextMenu } from '../repositories-list/repository-list-item-context-menu'
import { enableWorktreeSupport } from '../../lib/feature-flag'
import { SectionFilterList } from '../lib/section-filter-list'
import { assertNever } from '../../lib/fatal-error'
import { IAheadBehind } from '../../models/branch'

const BlankSlateImage = encodePathAsUrl(__dirname, 'static/empty-no-repo.svg')

const CollapsedGroupsStorageKey = 'repository-list-collapsed-groups'

const loadCollapsedIds = (): ReadonlySet<string> => {
  try {
    const raw = localStorage.getItem(CollapsedGroupsStorageKey)
    return raw ? new Set(JSON.parse(raw)) : new Set()
  } catch {
    return new Set()
  }
}

const saveCollapsedIds = (ids: ReadonlySet<string>) => {
  localStorage.setItem(CollapsedGroupsStorageKey, JSON.stringify([...ids]))
}

interface IRepositoriesListProps {
  readonly selectedRepository: Repositoryish | null
  readonly repositories: ReadonlyArray<Repositoryish>
  readonly recentRepositories: ReadonlyArray<number>

  /** A cache of the latest repository state values, keyed by the repository id */
  readonly localRepositoryStateLookup: ReadonlyMap<
    number,
    ILocalRepositoryState
  >

  /** Called when a repository has been selected. */
  readonly onSelectionChanged: (repository: Repositoryish) => void

  /** Whether the user has enabled the setting to confirm removing a repository from the app */
  readonly askForConfirmationOnRemoveRepository: boolean

  /** Called when the repository should be removed. */
  readonly onRemoveRepository: (repository: Repositoryish) => void

  /** Called when the repository should be shown in Finder/Explorer/File Manager. */
  readonly onShowRepository: (repository: Repositoryish) => void

  /** Called when the repository should be opened on GitHub in the default web browser. */
  readonly onViewOnGitHub: (repository: Repositoryish) => void

  /** Called when the repository should be shown in the shell. */
  readonly onOpenInShell: (repository: Repositoryish) => void

  /** Called when the repository should be opened in an external editor */
  readonly onOpenInExternalEditor: (repository: Repositoryish) => void

  /** The current external editor selected by the user */
  readonly externalEditorLabel?: string

  /** The label for the user's preferred shell. */
  readonly shellLabel?: string

  /** The callback to fire when the filter text has changed */
  readonly onFilterTextChanged: (text: string) => void

  /** The text entered by the user to filter their repository list */
  readonly filterText: string

  readonly dispatcher: Dispatcher
}

interface IRepositoriesListState {
  readonly newRepositoryMenuExpanded: boolean
  readonly selectedItem: RepositoryListRow | null

  /**
   * The set of group and owner-header ids that are currently collapsed
   * (hiding their repositories). Group ids come from `getGroupKey`, owner
   * ids from `IRepositoryListOwnerHeader.id`, so they share one namespace
   * without collision. Persisted across restarts.
   */
  readonly collapsedIds: ReadonlySet<string>
}

const RowHeight = 29

/**
 * Iterate over all groups until a list item is found that matches
 * the id of the provided repository.
 */
function findMatchingListItem(
  groups: ReadonlyArray<
    IFilterListGroup<RepositoryListRow, RepositoryListGroup>
  >,
  selectedRepository: Repositoryish | null
) {
  if (selectedRepository !== null) {
    for (const group of groups) {
      for (const item of group.items) {
        if (
          item.kind === 'repository' &&
          item.repository.id === selectedRepository.id
        ) {
          return item
        }
      }
    }
  }

  return null
}

/** The list of user-added repositories. */
export class RepositoriesList extends React.Component<
  IRepositoriesListProps,
  IRepositoriesListState
> {
  /**
   * A memoized function for grouping repositories for display
   * in the FilterList. The group will not be recomputed as long
   * as the provided list of repositories is equal to the last
   * time the method was called (reference equality).
   */
  private getRepositoryGroups = memoizeOne(
    (
      repositories: ReadonlyArray<Repositoryish> | null,
      localRepositoryStateLookup: ReadonlyMap<number, ILocalRepositoryState>,
      recentRepositories: ReadonlyArray<number>
    ) =>
      repositories === null
        ? []
        : groupRepositories(
            repositories,
            localRepositoryStateLookup,
            recentRepositories
          )
  )

  /**
   * A memoized function which hides the repositories belonging to a
   * collapsed group or owner sub-header. Bypassed while actively filtering
   * so a search never hides a match behind a collapsed section.
   */
  private getVisibleGroups = memoizeOne(
    (
      groups: ReadonlyArray<
        IFilterListGroup<RepositoryListRow, RepositoryListGroup>
      >,
      collapsedIds: ReadonlySet<string>,
      filterText: string
    ) => {
      if (filterText.length > 0 || collapsedIds.size === 0) {
        return groups
      }

      return groups.map(g => {
        if (collapsedIds.has(getGroupKey(g.identifier))) {
          // Keep the header visible (with zero items) rather than letting
          // FilterList hide the whole group -- otherwise there'd be no way
          // to click the header again to expand it.
          return { ...g, items: [], alwaysShowHeader: true }
        }

        const items: RepositoryListRow[] = []
        let hideRepos = false
        for (const item of g.items) {
          if (item.kind === 'owner-header') {
            hideRepos = collapsedIds.has(item.id)
          } else if (hideRepos) {
            continue
          }
          items.push(item)
        }

        return items.length === g.items.length ? g : { ...g, items }
      })
    }
  )

  /**
   * A memoized function for finding the selected list item based
   * on an IAPIRepository instance. The selected item will not be
   * recomputed as long as the provided list of repositories and
   * the selected data object is equal to the last time the method
   * was called (reference equality).
   *
   * See findMatchingListItem for more details.
   */
  private getSelectedListItem = memoizeOne(findMatchingListItem)

  public constructor(props: IRepositoriesListProps) {
    super(props)

    this.state = {
      newRepositoryMenuExpanded: false,
      selectedItem: null,
      collapsedIds: loadCollapsedIds(),
    }
  }

  private toggleCollapsed = (id: string) => {
    this.setState(prevState => {
      const collapsedIds = new Set(prevState.collapsedIds)
      if (collapsedIds.has(id)) {
        collapsedIds.delete(id)
      } else {
        collapsedIds.add(id)
      }
      saveCollapsedIds(collapsedIds)
      return { collapsedIds }
    })
  }

  private renderItem = (item: RepositoryListRow, matches: IMatches) => {
    if (item.kind === 'owner-header') {
      const collapsed = this.state.collapsedIds.has(item.id)
      return (
        <div
          key={item.id}
          className="repository-list-owner-header"
          role="button"
          aria-expanded={!collapsed}
        >
          <Octicon
            symbol={collapsed ? octicons.chevronRight : octicons.chevronDown}
          />
          <span>{item.owner}</span>
        </div>
      )
    }

    const repository = item.repository
    return (
      <RepositoryListItem
        key={repository.id}
        repository={repository}
        needsDisambiguation={item.needsDisambiguation}
        matches={matches}
        aheadBehind={item.aheadBehind}
        changedFilesCount={item.changedFilesCount}
      />
    )
  }

  private getAheadBehindTooltip = (aheadBehind: IAheadBehind | null) => {
    if (aheadBehind === null) {
      return null
    }

    const { ahead, behind } = aheadBehind

    if (behind === 0 && ahead === 0) {
      return null
    }

    return (
      'The currently checked out branch is' +
      (behind ? ` ${commitGrammar(behind)} behind ` : '') +
      (behind && ahead ? 'and' : '') +
      (ahead ? ` ${commitGrammar(ahead)} ahead of ` : '') +
      'its tracked branch.'
    )
  }

  private renderRowFocusTooltip = (
    item: RepositoryListRow
  ): JSX.Element | string | null => {
    if (item.kind === 'owner-header') {
      return null
    }

    const { repository, aheadBehind, changedFilesCount } = item
    const gitHubRepo =
      repository instanceof Repository ? repository.gitHubRepository : null
    const alias = repository instanceof Repository ? repository.alias : null
    const realName = gitHubRepo ? gitHubRepo.fullName : repository.name
    const aheadBehindTooltip = this.getAheadBehindTooltip(aheadBehind)
    const hasChanges = changedFilesCount > 0
    const uncommittedChangesTooltip = hasChanges
      ? `There are uncommitted changes in this repository.`
      : null

    const ahead = aheadBehind?.ahead ?? 0
    const behind = aheadBehind?.behind ?? 0

    return (
      <div className="repository-list-item-tooltip list-item-tooltip">
        <div>
          <div className="label">Full Name: </div>
          {realName}
          {alias && <> ({alias})</>}
        </div>
        <div>
          <div className="label">Path: </div>
          {repository.path}
        </div>
        {aheadBehindTooltip && (
          <div>
            <div className="label">
              <div className="ahead-behind">
                {ahead > 0 && <Octicon symbol={octicons.arrowUp} />}
                {behind > 0 && <Octicon symbol={octicons.arrowDown} />}
              </div>
            </div>
            {aheadBehindTooltip}
          </div>
        )}
        {uncommittedChangesTooltip && (
          <div>
            <div className="label">
              <span className="change-indicator-wrapper">
                <Octicon symbol={octicons.dotFill} />
              </span>
            </div>
            {uncommittedChangesTooltip}
          </div>
        )}
      </div>
    )
  }

  private getGroupLabel(group: RepositoryListGroup) {
    const { kind } = group
    if (kind === 'enterprise' || kind === 'gitea') {
      return group.host
    } else if (kind === 'other') {
      return 'Other'
    } else if (kind === 'dotcom') {
      return 'GitHub.com'
    } else if (kind === 'recent') {
      return 'Recent'
    } else {
      assertNever(kind, `Unknown repository group kind ${kind}`)
    }
  }

  private renderGroupHeader = (group: RepositoryListGroup) => {
    const label = this.getGroupLabel(group)
    const key = getGroupKey(group)
    const collapsed = this.state.collapsedIds.has(key)

    return (
      <TooltippedContent
        key={key}
        className="filter-list-group-header"
        tooltip={label}
        onlyWhenOverflowed={true}
        tagName="div"
      >
        <button
          type="button"
          className="repository-list-group-header-button"
          onClick={this.onGroupHeaderClick}
          data-group-key={key}
          aria-expanded={!collapsed}
        >
          <Octicon
            symbol={collapsed ? octicons.chevronRight : octicons.chevronDown}
          />
          <span>{label}</span>
        </button>
      </TooltippedContent>
    )
  }

  private onGroupHeaderClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    const key = event.currentTarget.dataset.groupKey
    if (key !== undefined) {
      this.toggleCollapsed(key)
    }
  }

  private onItemClick = (item: RepositoryListRow) => {
    if (item.kind === 'owner-header') {
      this.toggleCollapsed(item.id)
      return
    }

    if (item.kind !== 'repository') {
      return
    }

    const hasIndicator =
      item.changedFilesCount > 0 ||
      (item.aheadBehind !== null
        ? item.aheadBehind.ahead > 0 || item.aheadBehind.behind > 0
        : false)
    this.props.dispatcher.recordRepoClicked(hasIndicator)
    this.props.onSelectionChanged(item.repository)
  }

  private onItemContextMenu = (
    item: RepositoryListRow,
    event: React.MouseEvent<HTMLDivElement>
  ) => {
    event.preventDefault()

    if (item.kind !== 'repository') {
      return
    }

    const items = generateRepositoryListContextMenu({
      onRemoveRepository: this.props.onRemoveRepository,
      onShowRepository: this.props.onShowRepository,
      onOpenInShell: this.props.onOpenInShell,
      onOpenInExternalEditor: this.props.onOpenInExternalEditor,
      askForConfirmationOnRemoveRepository:
        this.props.askForConfirmationOnRemoveRepository,
      externalEditorLabel: this.props.externalEditorLabel,
      onChangeRepositoryAlias: this.onChangeRepositoryAlias,
      onRemoveRepositoryAlias: this.onRemoveRepositoryAlias,
      onViewOnGitHub: this.props.onViewOnGitHub,
      onCreateWorktree: enableWorktreeSupport()
        ? this.onCreateWorktree
        : undefined,
      onShowWorktrees: enableWorktreeSupport()
        ? this.onShowWorktrees
        : undefined,
      repository: item.repository,
      shellLabel: this.props.shellLabel,
    })

    showContextualMenu(items)
  }

  private getItemAriaLabel = (item: RepositoryListRow) =>
    item.kind === 'owner-header' ? item.owner : item.repository.name
  private getGroupAriaLabelGetter =
    (
      groups: ReadonlyArray<
        IFilterListGroup<RepositoryListRow, RepositoryListGroup>
      >
    ) =>
    (group: number) =>
      this.getGroupLabel(groups[group].identifier)

  public render() {
    const groups = this.getRepositoryGroups(
      this.props.repositories,
      this.props.localRepositoryStateLookup,
      this.props.recentRepositories
    )

    // So there's two types of selection at play here. There's the repository
    // selection for the whole app and then there's the keyboard selection in
    // the list itself. If the user has selected a repository using keyboard
    // navigation we want to honor that selection. If the user hasn't selected a
    // repository yet we'll select the repository currently selected in the app.
    const selectedItem =
      this.state.selectedItem ??
      this.getSelectedListItem(groups, this.props.selectedRepository)

    const visibleGroups = this.getVisibleGroups(
      groups,
      this.state.collapsedIds,
      this.props.filterText
    )

    return (
      <div className="repository-list">
        <SectionFilterList<RepositoryListRow, RepositoryListGroup>
          rowHeight={RowHeight}
          selectedItem={selectedItem}
          filterText={this.props.filterText}
          onFilterTextChanged={this.props.onFilterTextChanged}
          renderItem={this.renderItem}
          renderRowFocusTooltip={this.renderRowFocusTooltip}
          renderGroupHeader={this.renderGroupHeader}
          onItemClick={this.onItemClick}
          renderPostFilter={this.renderPostFilter}
          renderNoItems={this.renderNoItems}
          groups={visibleGroups}
          invalidationProps={{
            repositories: this.props.repositories,
            filterText: this.props.filterText,
            collapsedIds: this.state.collapsedIds,
          }}
          onItemContextMenu={this.onItemContextMenu}
          getGroupAriaLabel={this.getGroupAriaLabelGetter(visibleGroups)}
          getItemAriaLabel={this.getItemAriaLabel}
          onSelectionChanged={this.onSelectionChanged}
        />
      </div>
    )
  }

  private onSelectionChanged = (selectedItem: RepositoryListRow | null) => {
    this.setState({ selectedItem })
  }

  private renderPostFilter = () => {
    return (
      <Button
        className="new-repository-button"
        onClick={this.onNewRepositoryButtonClick}
        ariaExpanded={this.state.newRepositoryMenuExpanded}
        onKeyDown={this.onNewRepositoryButtonKeyDown}
      >
        Add
        <Octicon symbol={octicons.triangleDown} />
      </Button>
    )
  }

  private onNewRepositoryButtonKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>
  ) => {
    if (event.key === 'ArrowDown') {
      this.onNewRepositoryButtonClick()
    }
  }

  private renderNoItems = () => {
    return (
      <div className="no-items no-results-found">
        <img src={BlankSlateImage} className="blankslate-image" alt="" />
        <div className="title">Sorry, I can't find that repository</div>

        <div className="protip">
          ProTip! Press{' '}
          <div className="kbd-shortcut">
            <KeyboardShortcut darwinKeys={['⌘', 'O']} keys={['Ctrl', 'O']} />
          </div>{' '}
          to quickly add a local repository, and{' '}
          <div className="kbd-shortcut">
            <KeyboardShortcut
              darwinKeys={['⇧', '⌘', 'O']}
              keys={['Ctrl', 'Shift', 'O']}
            />
          </div>{' '}
          to clone from anywhere within the app
        </div>
      </div>
    )
  }

  private onNewRepositoryButtonClick = () => {
    const items: IMenuItem[] = [
      {
        label: __DARWIN__ ? 'Clone Repository…' : 'Clone repository…',
        action: this.onCloneRepository,
      },
      {
        label: __DARWIN__ ? 'Create New Repository…' : 'Create new repository…',
        action: this.onCreateNewRepository,
      },
      {
        label: __DARWIN__
          ? 'Add Existing Repository…'
          : 'Add existing repository…',
        action: this.onAddExistingRepository,
      },
    ]

    this.setState({ newRepositoryMenuExpanded: true })
    showContextualMenu(items).then(() => {
      this.setState({ newRepositoryMenuExpanded: false })
    })
  }

  private onCloneRepository = () => {
    this.props.dispatcher.showPopup({
      type: PopupType.CloneRepository,
      initialURL: null,
    })
  }

  private onAddExistingRepository = () => {
    this.props.dispatcher.showPopup({ type: PopupType.AddRepository })
  }

  private onCreateNewRepository = () => {
    this.props.dispatcher.showPopup({ type: PopupType.CreateRepository })
  }

  private onChangeRepositoryAlias = (repository: Repository) => {
    this.props.dispatcher.showPopup({
      type: PopupType.ChangeRepositoryAlias,
      repository,
    })
  }

  private onRemoveRepositoryAlias = (repository: Repository) => {
    this.props.dispatcher.changeRepositoryAlias(repository, null)
  }

  private onCreateWorktree = (repository: Repository) => {
    this.props.dispatcher.showPopup({
      type: PopupType.AddWorktree,
      repository,
    })
  }

  private onShowWorktrees = (repository: Repository) => {
    this.props.dispatcher.selectRepository(repository)
    this.props.dispatcher.showWorktreesFoldout()
  }
}
