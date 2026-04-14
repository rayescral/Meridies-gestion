const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store, max-age=0'
};

export function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: JSON_HEADERS });
}

function toNumber(value) {
  if (value == null || value === '') return null;
  const cleaned = String(value).replace(/\s/g, '').replace(/,/g, '.');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function firstNumberFromPatterns(text, patterns) {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match && match[1] != null) {
      const raw = String(match[1]).replace(/[\s,]/g, '');
      const n = Number(raw);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

async function safeJson(url, options = {}) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = (data && (data.error?.message || data.error || data.message)) || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

async function safeText(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return text;
}

export async function getInstagramLive() {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN || '';
  const username = process.env.INSTAGRAM_USERNAME || 'meridies.fr';

  if (token) {
    const me = await safeJson(
      `https://graph.instagram.com/me?fields=user_id,username,followers_count,media_count&access_token=${encodeURIComponent(token)}`
    );

    let likes = null;
    let comments = null;
    try {
      const media = await safeJson(
        `https://graph.instagram.com/me/media?fields=id,like_count,comments_count,timestamp&limit=12&access_token=${encodeURIComponent(token)}`
      );
      const items = Array.isArray(media?.data) ? media.data : [];
      likes = items.reduce((sum, item) => sum + (toNumber(item.like_count) || 0), 0);
      comments = items.reduce((sum, item) => sum + (toNumber(item.comments_count) || 0), 0);
    } catch (err) {
      // Optional enhancement only; follower counter should still work.
    }

    return {
      platform: 'instagram',
      source: 'official',
      username: me.username || username,
      handle: '@' + (me.username || username),
      followers: toNumber(me.followers_count),
      contentCount: toNumber(me.media_count),
      likes,
      comments,
      syncedAt: new Date().toISOString()
    };
  }

  // Best-effort public fallback. Public HTML can change at any time.
  const html = await safeText(`https://www.instagram.com/${encodeURIComponent(username)}/?hl=fr`, {
    headers: { 'user-agent': 'Mozilla/5.0' }
  });

  const followers = firstNumberFromPatterns(html, [
    /"followers_count"\s*:\s*([0-9]+)/i,
    /"edge_followed_by"\s*:\s*\{\s*"count"\s*:\s*([0-9]+)/i,
    /"follower_count"\s*:\s*([0-9]+)/i
  ]);

  const mediaCount = firstNumberFromPatterns(html, [
    /"media_count"\s*:\s*([0-9]+)/i,
    /"edge_owner_to_timeline_media"\s*:\s*\{[^}]*"count"\s*:\s*([0-9]+)/i
  ]);

  if (followers == null) {
    throw new Error('Instagram public fallback introuvable. Ajoute INSTAGRAM_ACCESS_TOKEN pour un live stable.');
  }

  return {
    platform: 'instagram',
    source: 'public-fallback',
    username,
    handle: '@' + username,
    followers,
    contentCount: mediaCount,
    syncedAt: new Date().toISOString()
  };
}

export async function getTikTokLive() {
  const token = process.env.TIKTOK_RESEARCH_ACCESS_TOKEN || '';
  const username = process.env.TIKTOK_USERNAME || 'meridies.fr';

  if (token) {
    const data = await safeJson(
      'https://open.tiktokapis.com/v2/research/user/info/?fields=display_name,avatar_url,is_verified,follower_count,following_count,likes_count,video_count,bio_url',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username })
      }
    );

    const user = data?.data || {};
    return {
      platform: 'tiktok',
      source: 'official-research',
      username,
      handle: '@' + username,
      followers: toNumber(user.follower_count),
      contentCount: toNumber(user.video_count),
      likes: toNumber(user.likes_count),
      syncedAt: new Date().toISOString()
    };
  }

  const html = await safeText(`https://www.tiktok.com/@${encodeURIComponent(username)}`, {
    headers: { 'user-agent': 'Mozilla/5.0' }
  });

  const followers = firstNumberFromPatterns(html, [
    /"followerCount"\s*:\s*([0-9]+)/i,
    /"followers"\s*:\s*([0-9]+)/i
  ]);
  const videoCount = firstNumberFromPatterns(html, [
    /"videoCount"\s*:\s*([0-9]+)/i
  ]);
  const likesCount = firstNumberFromPatterns(html, [
    /"heartCount"\s*:\s*([0-9]+)/i,
    /"likesCount"\s*:\s*([0-9]+)/i
  ]);

  if (followers == null) {
    throw new Error('TikTok public fallback introuvable. Ajoute TIKTOK_RESEARCH_ACCESS_TOKEN pour un live stable.');
  }

  return {
    platform: 'tiktok',
    source: 'public-fallback',
    username,
    handle: '@' + username,
    followers,
    contentCount: videoCount,
    likes: likesCount,
    syncedAt: new Date().toISOString()
  };
}

export async function buildLivePayload() {
  const [instagram, tiktok] = await Promise.allSettled([
    getInstagramLive(),
    getTikTokLive()
  ]);

  const payload = {
    ok: true,
    generatedAt: new Date().toISOString(),
    instagram: instagram.status === 'fulfilled' ? instagram.value : { error: instagram.reason?.message || 'Erreur Instagram' },
    tiktok: tiktok.status === 'fulfilled' ? tiktok.value : { error: tiktok.reason?.message || 'Erreur TikTok' }
  };

  payload.ok = !payload.instagram.error || !payload.tiktok.error;
  return payload;
}

export function buildStatus() {
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    instagram: {
      configured: Boolean(process.env.INSTAGRAM_ACCESS_TOKEN),
      mode: process.env.INSTAGRAM_ACCESS_TOKEN ? 'official' : 'public-fallback'
    },
    tiktok: {
      configured: Boolean(process.env.TIKTOK_RESEARCH_ACCESS_TOKEN),
      mode: process.env.TIKTOK_RESEARCH_ACCESS_TOKEN ? 'official-research' : 'public-fallback'
    }
  };
}
