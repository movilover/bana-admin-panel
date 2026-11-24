import React, { useMemo, useState } from 'react';
import { Film, Flag, Search, Trash2 } from 'lucide-react';
import { deleteDoc, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '@/src/firebase';
import { invokeCloudFunction } from '@/src/lib/firebasePlan';
import { AdminCard, AdminPagination, AdminStateIndicator } from '@/src/components/admin/AdminShared';
import { formatCompactNumber, formatRelativeTime } from '@/src/lib/mediaUtils';
import { isFunctionsFallbackError } from '@/src/lib/monetization';
import { formatDurationClock } from '@/src/lib/videoUtils';
import { DISCOVERY_CATEGORIES } from '@/src/types/bana';
import { AdminReelReviewModal } from '@/src/components/admin/AdminReelReviewModal';

interface AdminContentSectionProps {
  posts: any[];
  reels: any[];
  stories: any[];
  comments: any[];
  voiceComments: any[];
  reports: any[];
  canModerateContent: boolean;
  onInspectCreator: (searchTerm: string) => void;
  onWriteAudit: (action: string, targetType: string, targetId: string, summary: string) => Promise<void>;
  onNotifyAction: (msg: string) => void;
  onAskConfirm: (cfg: {
    title: string;
    description: string;
    confirmLabel: string;
    variant?: 'danger' | 'primary';
    action: () => Promise<void>;
  }) => void;
}

type ContentTab = 'posts' | 'reels' | 'videos' | 'stories' | 'comments' | 'voice_comments';
const PAGE_SIZE = 12;

export function AdminContentSection({
  posts,
  reels,
  stories,
  comments,
  voiceComments,
  reports,
  canModerateContent,
  onInspectCreator,
  onWriteAudit,
  onNotifyAction,
  onAskConfirm,
}: AdminContentSectionProps) {
  const [subTab, setSubTab] = useState<ContentTab>('posts');
  const [search, setSearch] = useState('');
  const [postTypeFilter, setPostTypeFilter] = useState('all');
  const [videoStatusFilter, setVideoStatusFilter] = useState<'all' | 'active' | 'draft' | 'removed' | 'reported'>('all');
  const [videoVisFilter, setVideoVisFilter] = useState<'all' | 'public' | 'followers' | 'only_me'>('all');
  const [videoCatFilter, setVideoCatFilter] = useState('all');
  const [page, setPage] = useState(1);

  const reportedIds = useMemo(
    () => new Set(reports.map((r) => r.targetId).filter(Boolean)),
    [reports]
  );

  const [reviewReelId, setReviewReelId] = useState<string | null>(null);

  const videoPosts = useMemo(() => posts.filter((p) => p.type === 'video'), [posts]);

  const moderateItem = async (
    colName: 'posts' | 'reels' | 'stories' | 'comments' | 'voiceComments',
    docId: string,
    action: 'remove' | 'restore' | 'delete',
    reason: string
  ) => {
    try {
      await invokeCloudFunction('adminModerateContent', {
        collectionName: colName,
        docId,
        action,
        reason,
      });
    } catch (err: any) {
      if (!isFunctionsFallbackError(err)) throw err;
      if (action === 'delete') {
        await deleteDoc(doc(db, colName, docId));
      } else {
        const nextStatus = action === 'remove' ? 'removed' : colName === 'posts' ? 'published' : 'active';
        await updateDoc(doc(db, colName, docId), {
          status: nextStatus,
          updatedAt: serverTimestamp(),
        });
      }
      await onWriteAudit(`moderate_${action}_${colName}`, colName, docId, reason);
    }
    onNotifyAction(`Content ${action === 'delete' ? 'deleted' : action === 'remove' ? 'removed' : 'restored'}.`);
  };

  const activeList = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (subTab === 'posts') {
      return posts.filter((p) => {
        if (postTypeFilter !== 'all' && p.type !== postTypeFilter) return false;
        if (!q) return true;
        return (
          String(p.authorUsername || '').toLowerCase().includes(q) ||
          String(p.content || '').toLowerCase().includes(q) ||
          String(p.id || '').toLowerCase().includes(q)
        );
      });
    }
    if (subTab === 'reels' || subTab === 'videos') {
      const base = [
        ...reels.map((r) => ({ ...r, _col: 'reels' as const })),
        ...(subTab === 'videos' ? videoPosts.map((v) => ({ ...v, _col: 'posts' as const })) : []),
      ];
      return base.filter((v) => {
        const itemStatus = v.status === 'published' ? 'active' : v.status || 'active';
        if (videoStatusFilter === 'reported' && !reportedIds.has(v.id)) return false;
        if (videoStatusFilter !== 'all' && videoStatusFilter !== 'reported' && itemStatus !== videoStatusFilter)
          return false;
        if (videoVisFilter !== 'all' && v.visibility !== videoVisFilter) return false;
        if (videoCatFilter !== 'all' && v.category !== videoCatFilter) return false;
        if (!q) return true;
        return (
          String(v.authorUsername || '').toLowerCase().includes(q) ||
          String(v.title || '').toLowerCase().includes(q) ||
          String(v.caption || v.content || '').toLowerCase().includes(q) ||
          String(v.id || '').toLowerCase().includes(q)
        );
      });
    }
    if (subTab === 'stories') {
      return stories.filter((st) => {
        if (!q) return true;
        return (
          String(st.authorUsername || '').toLowerCase().includes(q) ||
          String(st.caption || '').toLowerCase().includes(q)
        );
      });
    }
    if (subTab === 'comments') {
      return comments.filter((c) => {
        if (!q) return true;
        return (
          String(c.authorUsername || '').toLowerCase().includes(q) ||
          String(c.content || '').toLowerCase().includes(q)
        );
      });
    }
    return voiceComments.filter((vc) => {
      if (!q) return true;
      return String(vc.authorUsername || '').toLowerCase().includes(q);
    });
  }, [
    subTab,
    search,
    postTypeFilter,
    videoStatusFilter,
    videoVisFilter,
    videoCatFilter,
    posts,
    reels,
    videoPosts,
    stories,
    comments,
    voiceComments,
    reportedIds,
  ]);

  const paged = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return activeList.slice(start, start + PAGE_SIZE);
  }, [activeList, page]);

  const tabs: Array<{ id: ContentTab; label: string }> = [
    { id: 'posts', label: `Posts (${posts.length})` },
    { id: 'reels', label: `Reels (${reels.length})` },
    { id: 'videos', label: `Videos (${reels.length + videoPosts.length})` },
    { id: 'stories', label: `Stories (${stories.length})` },
    { id: 'comments', label: `Comments (${comments.length})` },
    { id: 'voice_comments', label: `Voice Comments (${voiceComments.length})` },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setSubTab(t.id);
              setPage(1);
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
              subTab === t.id
                ? 'bg-[#1877F2] text-white'
                : 'bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-neutral-600 dark:text-neutral-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <AdminCard className="p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display font-bold text-lg capitalize">
              {subTab.replace('_', ' ')} Moderation ({activeList.length})
            </h2>
            <p className="text-xs text-neutral-500">
              Audit published media, remove policy-violating items from public feeds, or permanently delete content.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Search @username, caption, ID..."
                className="h-9 pl-8 pr-3 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 text-xs"
              />
            </div>

            {subTab === 'posts' && (
              <select
                value={postTypeFilter}
                onChange={(e) => {
                  setPostTypeFilter(e.target.value);
                  setPage(1);
                }}
                className="h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-2.5 text-xs"
              >
                <option value="all">All Types</option>
                <option value="text">Text</option>
                <option value="image">Image</option>
                <option value="gallery">Gallery</option>
                <option value="video">Video</option>
                <option value="voice">Voice</option>
                <option value="poll">Poll</option>
              </select>
            )}

            {(subTab === 'reels' || subTab === 'videos') && (
              <>
                <select
                  value={videoStatusFilter}
                  onChange={(e) => {
                    setVideoStatusFilter(e.target.value as any);
                    setPage(1);
                  }}
                  className="h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-2.5 text-xs"
                >
                  <option value="all">All Statuses</option>
                  <option value="active">Active</option>
                  <option value="draft">Draft</option>
                  <option value="removed">Removed</option>
                  <option value="reported">Reported Only</option>
                </select>
                <select
                  value={videoVisFilter}
                  onChange={(e) => {
                    setVideoVisFilter(e.target.value as any);
                    setPage(1);
                  }}
                  className="h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-2.5 text-xs"
                >
                  <option value="all">All Visibility</option>
                  <option value="public">Public</option>
                  <option value="followers">Followers</option>
                  <option value="only_me">Only me</option>
                </select>
                <select
                  value={videoCatFilter}
                  onChange={(e) => {
                    setVideoCatFilter(e.target.value);
                    setPage(1);
                  }}
                  className="h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-2.5 text-xs"
                >
                  <option value="all">All Categories</option>
                  {DISCOVERY_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>
        </div>

        {paged.length === 0 ? (
          <p className="text-xs text-neutral-500 py-8 text-center">No items match the current filters.</p>
        ) : subTab === 'posts' ? (
          <div className="divide-y divide-neutral-100 dark:divide-neutral-800 text-xs">
            {paged.map((p: any) => (
              <div key={p.id} className="py-3 flex items-center justify-between gap-3">
                <div className="min-w-0 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">@{p.authorUsername}</span>
                    <span className="font-mono text-[11px] text-neutral-500 uppercase">{p.type}</span>
                    <AdminStateIndicator status={p.status || 'published'} />
                    {reportedIds.has(p.id) && (
                      <span className="font-mono text-[10px] font-bold text-rose-600 inline-flex items-center gap-0.5">
                        <Flag className="w-3 h-3" /> Reported
                      </span>
                    )}
                  </div>
                  <p className="text-neutral-600 dark:text-neutral-400 truncate">
                    {p.content || '(Media / interactive post)'}
                  </p>
                  <p className="font-mono text-[10px] text-neutral-400">
                    {p.likesCount || 0} likes · {p.commentsCount || 0} comments · {formatRelativeTime(p.createdAt)}
                  </p>
                </div>
                {canModerateContent && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        const isRemoved = p.status === 'removed';
                        onAskConfirm({
                          title: isRemoved ? 'Restore Post' : 'Remove Post from Public Feed',
                          description: isRemoved
                            ? `Restore @${p.authorUsername}'s post?`
                            : `Hide @${p.authorUsername}'s post while retaining safety record?`,
                          confirmLabel: isRemoved ? 'Restore' : 'Remove Post',
                          variant: isRemoved ? 'primary' : 'danger',
                          action: () =>
                            moderateItem(
                              'posts',
                              p.id,
                              isRemoved ? 'restore' : 'remove',
                              `${isRemoved ? 'Restored' : 'Removed'} post by @${p.authorUsername}`
                            ),
                        });
                      }}
                      className="px-2.5 py-1 rounded-lg border border-neutral-200 dark:border-neutral-700 font-semibold"
                    >
                      {p.status === 'removed' ? 'Restore' : 'Remove'}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onAskConfirm({
                          title: 'Delete Post Permanently',
                          description: `Permanently delete this post by @${p.authorUsername}?`,
                          confirmLabel: 'Delete Permanently',
                          variant: 'danger',
                          action: () => moderateItem('posts', p.id, 'delete', `Deleted post by @${p.authorUsername}`),
                        })
                      }
                      className="p-1.5 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : subTab === 'reels' || subTab === 'videos' ? (
          <div className="divide-y divide-neutral-100 dark:divide-neutral-800 text-xs">
            {paged.map((v: any) => {
              const sizeMb = v.fileSizeBytes ? `${(Number(v.fileSizeBytes) / (1024 * 1024)).toFixed(1)} MB` : null;
              return (
                <div
                  key={`${v._col}_${v.id}`}
                  className="py-3 flex flex-col lg:flex-row lg:items-center justify-between gap-3"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    {v.thumbnailUrl ? (
                      <img loading="lazy"
                        src={v.thumbnailUrl}
                        alt={v.title || v.authorUsername}
                        className="h-14 w-10 rounded-lg object-cover border border-neutral-200 dark:border-neutral-800 shrink-0 bg-black"
                      />
                    ) : (
                      <div className="h-14 w-10 rounded-lg bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-neutral-500 shrink-0">
                        <Film className="w-4 h-4" />
                      </div>
                    )}
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">@{v.authorUsername}</span>
                        <span className="font-mono text-[10px] text-neutral-500 uppercase">
                          {v._col === 'reels' ? 'Reel' : 'Video Post'}
                        </span>
                        <AdminStateIndicator status={v.status || 'active'} />
                        {reportedIds.has(v.id) && (
                          <span className="font-mono text-[10px] font-bold text-rose-600 inline-flex items-center gap-0.5">
                            <Flag className="w-3 h-3" /> Reported
                          </span>
                        )}
                      </div>
                      <p className="text-neutral-800 dark:text-neutral-200 font-medium truncate">
                        {v.title || v.caption || v.content || v.videoUrl || v.mediaUrls?.[0]}
                      </p>
                      <p className="text-[11px] text-neutral-500 font-mono tabular-nums">
                        {formatCompactNumber(v.viewsCount || 0)} views · {formatCompactNumber(v.likesCount || 0)} likes ·{' '}
                        {formatCompactNumber(v.commentsCount || 0)} comments
                        {v.durationSeconds ? ` · ${formatDurationClock(v.durationSeconds)}` : ''}
                        {sizeMb ? ` · ${sizeMb}` : ''}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                    {canModerateContent && (
                      <select
                        value={v.visibility || 'public'}
                        onChange={async (e) => {
                          const nextVis = e.target.value;
                          await updateDoc(doc(db, v._col, v.id), {
                            visibility: nextVis,
                            updatedAt: serverTimestamp(),
                          });
                          await onWriteAudit(
                            'video_visibility',
                            v._col,
                            v.id,
                            `Set visibility=${nextVis} for @${v.authorUsername}`
                          );
                          onNotifyAction(`Visibility set to ${nextVis}.`);
                        }}
                        className="h-8 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-950 px-2 text-[11px]"
                      >
                        <option value="public">Public</option>
                        <option value="followers">Followers</option>
                        <option value="only_me">Only me</option>
                      </select>
                    )}
                    {v._col === 'reels' && (
                      <button
                        type="button"
                        onClick={() => setReviewReelId(v.id)}
                        className="h-8 px-2.5 rounded-lg bg-[#1877F2] text-white text-[11px] font-semibold"
                      >
                        Review
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onInspectCreator(v.authorUsername || v.authorId || '')}
                      className="h-8 px-2.5 rounded-lg border border-neutral-200 dark:border-neutral-700 text-[11px] font-medium"
                    >
                      Creator
                    </button>
                    {canModerateContent && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            const isRemoved = v.status === 'removed';
                            onAskConfirm({
                              title: isRemoved ? 'Restore Video' : 'Remove Video',
                              description: `${isRemoved ? 'Restore' : 'Remove'} @${v.authorUsername}'s video?`,
                              confirmLabel: isRemoved ? 'Restore' : 'Remove',
                              variant: isRemoved ? 'primary' : 'danger',
                              action: () =>
                                moderateItem(
                                  v._col,
                                  v.id,
                                  isRemoved ? 'restore' : 'remove',
                                  `${isRemoved ? 'Restored' : 'Removed'} video by @${v.authorUsername}`
                                ),
                            });
                          }}
                          className="h-8 px-2.5 rounded-lg border border-neutral-200 dark:border-neutral-700 text-[11px] font-semibold"
                        >
                          {v.status === 'removed' ? 'Restore' : 'Remove'}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            onAskConfirm({
                              title: 'Delete Video Permanently',
                              description: `Permanently delete this video from @${v.authorUsername}?`,
                              confirmLabel: 'Delete Permanently',
                              variant: 'danger',
                              action: () =>
                                moderateItem(v._col, v.id, 'delete', `Deleted video by @${v.authorUsername}`),
                            })
                          }
                          className="p-1.5 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : subTab === 'stories' ? (
          <div className="divide-y divide-neutral-100 dark:divide-neutral-800 text-xs">
            {paged.map((st: any) => (
              <div key={st.id} className="py-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  {st.mediaUrl && st.mediaType === 'image' ? (
                    <img loading="lazy"
                      src={st.mediaUrl}
                      alt={st.caption || st.authorUsername}
                      className="h-12 w-9 rounded-lg object-cover border border-neutral-200 dark:border-neutral-800 shrink-0"
                    />
                  ) : (
                    <div className="h-12 w-9 rounded-lg bg-[#1877F2]/10 text-[#1877F2] flex items-center justify-center font-bold uppercase text-[10px] shrink-0">
                      {st.mediaType || 'txt'}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="font-semibold">
                      @{st.authorUsername} · <span className="capitalize">{st.mediaType}</span> ·{' '}
                      <span className="font-mono">{st.viewsCount || 0} views</span>
                    </p>
                    <p className="text-neutral-500 truncate">
                      {st.caption || '(No caption)'} · {formatRelativeTime(st.createdAt)}
                    </p>
                  </div>
                </div>
                {canModerateContent && (
                  <button
                    type="button"
                    onClick={() =>
                      onAskConfirm({
                        title: 'Remove Story',
                        description: `Delete 24h story by @${st.authorUsername}?`,
                        confirmLabel: 'Remove Story',
                        variant: 'danger',
                        action: () => moderateItem('stories', st.id, 'delete', `Removed story by @${st.authorUsername}`),
                      })
                    }
                    className="p-2 text-rose-600 rounded-lg"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="divide-y divide-neutral-100 dark:divide-neutral-800 text-xs">
            {paged.map((item: any) => (
              <div key={item.id} className="py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold">
                    @{item.authorUsername} ·{' '}
                    <span className="font-mono text-neutral-500">
                      {item.targetType} / {item.targetId}
                    </span>
                  </p>
                  <p className="text-neutral-500 truncate">
                    {subTab === 'comments' ? item.content : `Voice note (${item.durationSeconds || 0}s)`}
                  </p>
                </div>
                {canModerateContent && (
                  <button
                    type="button"
                    onClick={() =>
                      onAskConfirm({
                        title: 'Delete Comment',
                        description: `Delete this ${subTab === 'comments' ? 'comment' : 'voice comment'} by @${item.authorUsername}?`,
                        confirmLabel: 'Delete',
                        variant: 'danger',
                        action: () =>
                          moderateItem(
                            subTab === 'comments' ? 'comments' : 'voiceComments',
                            item.id,
                            'delete',
                            `Removed ${subTab} by @${item.authorUsername}`
                          ),
                      })
                    }
                    className="p-2 text-rose-600 rounded-lg shrink-0"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        <AdminPagination page={page} totalItems={activeList.length} pageSize={PAGE_SIZE} onPageChange={setPage} />
      </AdminCard>

      {reviewReelId && (
        <AdminReelReviewModal
          reelId={reviewReelId}
          canModerate={canModerateContent}
          onClose={() => setReviewReelId(null)}
          onInspectCreator={(term) => {
            setReviewReelId(null);
            onInspectCreator(term);
          }}
          onModerate={(reel, action) =>
            onAskConfirm({
              title: action === 'remove' ? 'Remove Reel' : 'Restore Reel',
              description: `${action === 'remove' ? 'Remove' : 'Restore'} @${reel.authorUsername}'s Reel?`,
              confirmLabel: action === 'remove' ? 'Remove' : 'Restore',
              variant: action === 'remove' ? 'danger' : 'primary',
              action: async () => {
                await moderateItem('reels', reel.id, action, `${action === 'remove' ? 'Removed' : 'Restored'} reel by @${reel.authorUsername} after review`);
                setReviewReelId(null);
              },
            })
          }
        />
      )}
    </div>
  );
}
