import JSZip from 'jszip';
import { v4 as uuidv4 } from 'uuid';
import { ImportResult, UserRow } from '../types';
import { parseCSVFile } from './csv';

type InstagramStringListItem = {
  href?: string;
  value?: string;
};

type InstagramRelationshipItem = {
  title?: string;
  string_list_data?: InstagramStringListItem[];
};

type InstagramFollowingPayload = {
  relationships_following?: InstagramRelationshipItem[];
};

function buildImportResult(nonFollowers: string[], followingCount: number, followerCount: number): ImportResult {
  return {
    users: buildUserRows(nonFollowers, 'not following back'),
    source: 'instagram-export',
    summary: {
      label: `${nonFollowers.length} accounts do not follow you back`,
      details: `Following: ${followingCount} | Followers: ${followerCount}`,
    },
  };
}

function normalizeUsername(username: string): string {
  return username.trim().replace(/^@+/, '').toLowerCase();
}

function extractUsernameFromHref(href?: string): string | null {
  if (!href) {
    return null;
  }

  try {
    const url = new URL(href, 'https://www.instagram.com');
    const segments = url.pathname.split('/').filter(Boolean);
    const usernameSegment = segments[segments.length - 1];
    return usernameSegment ? normalizeUsername(usernameSegment) : null;
  } catch {
    return null;
  }
}

function extractUsername(entry: InstagramRelationshipItem): string | null {
  if (entry.title?.trim()) {
    return normalizeUsername(entry.title);
  }

  for (const stringEntry of entry.string_list_data ?? []) {
    if (stringEntry.value?.trim()) {
      return normalizeUsername(stringEntry.value);
    }

    const fromHref = extractUsernameFromHref(stringEntry.href);
    if (fromHref) {
      return fromHref;
    }
  }

  return null;
}

function buildUserRows(usernames: string[], category = ''): UserRow[] {
  return usernames.map((username, index) => ({
    id: uuidv4(),
    username,
    status: 'pending',
    notes: '',
    category,
    originalIndex: index,
  }));
}

function extractUsernamesFromHtml(html: string): string[] {
  const document = new DOMParser().parseFromString(html, 'text/html');
  const usernames: string[] = [];
  const seen = new Set<string>();

  for (const anchor of Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
    const username = extractUsernameFromHref(anchor.getAttribute('href') ?? undefined);

    if (!username || seen.has(username)) {
      continue;
    }

    seen.add(username);
    usernames.push(username);
  }

  return usernames;
}

async function parseInstagramJsonExport(zip: JSZip): Promise<ImportResult | null> {
  const followingEntry = zip.file(/(^|\/)following\.json$/i)[0];
  const followerEntries = zip.file(/(^|\/)followers(?:_\d+)?\.json$/i);

  if (!followingEntry || followerEntries.length === 0) {
    return null;
  }

  const followingPayload = JSON.parse(await followingEntry.async('text')) as InstagramFollowingPayload;
  const followingItems = followingPayload.relationships_following ?? [];
  const followingUsers: string[] = [];
  const followingSeen = new Set<string>();

  for (const item of followingItems) {
    const username = extractUsername(item);
    if (!username || followingSeen.has(username)) {
      continue;
    }

    followingSeen.add(username);
    followingUsers.push(username);
  }

  const followerSet = new Set<string>();
  for (const entry of followerEntries) {
    const payload = JSON.parse(await entry.async('text')) as InstagramRelationshipItem[];
    for (const item of payload) {
      const username = extractUsername(item);
      if (username) {
        followerSet.add(username);
      }
    }
  }

  const nonFollowers = followingUsers.filter((username) => !followerSet.has(username));

  return buildImportResult(nonFollowers, followingUsers.length, followerSet.size);
}

async function parseInstagramHtmlExport(zip: JSZip): Promise<ImportResult | null> {
  const followingEntry = zip.file(/(^|\/)following\.html$/i)[0];
  const followerEntries = zip.file(/(^|\/)followers(?:_\d+)?\.html$/i);

  if (!followingEntry || followerEntries.length === 0) {
    return null;
  }

  const followingUsers = extractUsernamesFromHtml(await followingEntry.async('text'));
  const followerSet = new Set<string>();

  for (const entry of followerEntries) {
    const usernames = extractUsernamesFromHtml(await entry.async('text'));
    for (const username of usernames) {
      followerSet.add(username);
    }
  }

  const nonFollowers = followingUsers.filter((username) => !followerSet.has(username));

  return buildImportResult(nonFollowers, followingUsers.length, followerSet.size);
}

async function parseInstagramExport(file: File): Promise<ImportResult> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const jsonResult = await parseInstagramJsonExport(zip);

  if (jsonResult) {
    return jsonResult;
  }

  const htmlResult = await parseInstagramHtmlExport(zip);

  if (htmlResult) {
    return htmlResult;
  }

  const knownEntries = zip.file(/(^|\/)(following|followers(?:_\d+)?)\.(json|html)$/i);

  if (knownEntries.some((entry) => entry.name.toLowerCase().endsWith('.html'))) {
    throw new Error('Instagram export ZIP is missing following.html or followers_*.html files.');
  }

  if (knownEntries.some((entry) => entry.name.toLowerCase().endsWith('.json'))) {
    throw new Error('Instagram export ZIP is missing following.json or followers files.');
  }

  throw new Error('Instagram export ZIP is missing supported following/followers files.');
}

async function parseCsvImport(file: File): Promise<ImportResult> {
  const users = await parseCSVFile(file);
  return {
    users,
    source: 'csv',
    summary: {
      label: `${users.length} accounts imported from CSV`,
      details: 'Ready for manual review and unfollow actions.',
    },
  };
}

export async function parseImportFile(file: File): Promise<ImportResult> {
  const fileName = file.name.toLowerCase();

  if (fileName.endsWith('.zip')) {
    return parseInstagramExport(file);
  }

  if (fileName.endsWith('.csv')) {
    return parseCsvImport(file);
  }

  throw new Error('Unsupported file type. Use a CSV or an Instagram export ZIP.');
}
