import fs from 'fs';
import path from 'path';
import { glob } from 'glob';
import os from 'os';
import crypto from 'crypto';
import { execSync } from 'child_process';

export interface SessionSummary {
  id: string;
  title: string;
  preview: string;
  userPrompts: string[];
  timestamp: number;
  source: 'claude' | 'codex' | 'cursor' | 'gemini';
  path: string;
}

// --- Helper Functions ---

function createPreview(content: string, maxLength: number = 500): string {
  if (content.length <= maxLength) return content;

  const start = content.slice(0, maxLength / 2);
  const end = content.slice(content.length - (maxLength / 2));

  return `${start}\n\n... [${content.length - maxLength} characters omitted] ...\n\n${end}`;
}

// --- Claude Adapter ---

function normalizeCwd(cwd: string): string {
  return path.resolve(cwd);
}

function getClaudeEncodedPath(projectPath: string): string {
  // Claude encodes paths by replacing /, ., and _ with -
  // e.g. /home/user/project -> -home-user-project
  // e.g. /path/v1.0 -> -path-v1-0
  // e.g. /home/work_ro -> -home-work-ro
  return projectPath.replace(/[\/\._]/g, '-');
}

export async function getClaudeSessions(cwd: string, limit: number = 10): Promise<SessionSummary[]> {
  const resolvedCwd = normalizeCwd(cwd);
  const homeDir = os.homedir();
  const encodedPath = getClaudeEncodedPath(resolvedCwd);
  const projectDir = path.join(homeDir, '.claude', 'projects', encodedPath);

  if (!fs.existsSync(projectDir)) {
    return [];
  }

  const files = glob.sync('*.jsonl', { cwd: projectDir });

  // Sort by modification time (descending)
  const sortedFiles = files.map((file: string) => {
      const filePath = path.join(projectDir, file);
      const stats = fs.statSync(filePath);
      return { file, mtime: stats.mtimeMs, filePath };
    })
    .sort((a: any, b: any) => b.mtime - a.mtime)
    .slice(0, limit);

  const sessions: SessionSummary[] = [];

  for (const { filePath, file } of sortedFiles) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim() !== '');

    if (lines.length === 0) continue;

    let firstUserMessage = 'New Session';
    let fullContent = '';
    const userPrompts: string[] = [];

    for (const line of lines) {
      try {
        const data = JSON.parse(line);

        // Try to find the first user message for the title
        if (data.type === 'user' && data.message?.content) {
            const text = typeof data.message.content === 'string'
                ? data.message.content
                : (Array.isArray(data.message.content) ? data.message.content.map((c: any) => c.text || '').join(' ') : '');

            userPrompts.push(text);

          if (firstUserMessage === 'New Session') {
             firstUserMessage = text;
          }
        }

        // Accumulate content for preview (simplified)
        if (data.type === 'user' && data.message?.content) {
            const text = typeof data.message.content === 'string' ? data.message.content : 'User Input...';
            fullContent += `User: ${text}\n`;
        } else if (data.message?.content && data.type !== 'user') { // Assistant or other
             const text = typeof data.message.content === 'string' ? data.message.content : 'Assistant Output...';
             fullContent += `Assistant: ${text}\n`;
        } else if (data.display) {
             fullContent += `System: ${data.display}\n`;
        }

      } catch (e) {
        // ignore parse errors
      }
    }

    // Create preview: Start ... End
    const preview = createPreview(fullContent);
    const stats = fs.statSync(filePath);

    sessions.push({
      id: path.basename(file, '.jsonl'),
      title: firstUserMessage.slice(0, 50) + (firstUserMessage.length > 50 ? '...' : ''),
      preview,
      userPrompts,
      timestamp: stats.mtimeMs,
      source: 'claude',
      path: filePath
    });
  }

  return sessions;
}

// --- Codex Adapter ---

export async function getCodexSessions(cwd: string, limit: number = 10): Promise<SessionSummary[]> {
    const homeDir = os.homedir();
    const resolvedCwd = normalizeCwd(cwd);
    const sessionsDir = path.join(homeDir, '.codex', 'sessions');

    if (!fs.existsSync(sessionsDir)) {
        return [];
    }

    // We need to search deeply because of the date structure YYYY/MM/DD
    // Optimization: Start searching from current year/month/day backwards could be better but glob is easier for MVP
    // To avoid scanning ALL history, maybe we limit glob depth or just look at recent folders?
    // For now, let's just glob all .jsonl and filter by CWD. In production, this should be optimized.
    // Actually, reading all files to check CWD is slow.
    // Strategy: Walk directories from today backwards?
    // Let's use a simpler approach: glob all jsonl in the last 3 levels of directories

    // Note: This might be slow if history is huge.
    const files = glob.sync('**/*.jsonl', { cwd: sessionsDir, absolute: true });

    // Filter by CWD and sort by time
    const relevantFiles: { filePath: string, mtime: number }[] = [];

    for (const filePath of files) {
        // We need to peek at the first line to check CWD
        try {
            const fd = fs.openSync(filePath, 'r');
            const buffer = Buffer.alloc(4096); // Read first 4KB
            const bytesRead = fs.readSync(fd, buffer, 0, 4096, 0);
            fs.closeSync(fd);

            const chunk = buffer.toString('utf-8', 0, bytesRead);
            const firstLine = chunk.split('\n')[0];

            if (firstLine) {
                const meta = JSON.parse(firstLine);
                const metaCwd = typeof meta.payload?.cwd === 'string' ? normalizeCwd(meta.payload.cwd) : '';
                if (meta.type === 'session_meta' && metaCwd === resolvedCwd) {
                     const stats = fs.statSync(filePath);
                     relevantFiles.push({ filePath, mtime: stats.mtimeMs });
                }
            }
        } catch (e) {
            // ignore
        }
    }

    const sortedFiles = relevantFiles
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, limit);

    const sessions: SessionSummary[] = [];

    for (const { filePath, mtime } of sortedFiles) {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n').filter(line => line.trim() !== '');

        let firstUserMessage = 'New Session';
        let fullContent = '';
        const userPrompts: string[] = [];

        for (const line of lines) {
            try {
                const data = JSON.parse(line);

                // Codex User Input
                if (data.type === 'response_item' && data.payload?.type === 'message' && data.payload.role === 'user') {
                    const contentArr = data.payload.content || [];
                    const text = contentArr.find((c: any) => c.type === 'input_text')?.text || '';

                    userPrompts.push(text);

                    if (firstUserMessage === 'New Session' && text) {
                        firstUserMessage = text;
                    }
                    fullContent += `User: ${text}\n`;
                }
                // Codex Assistant Response (simplified logic)
                // Codex format is a bit complex with chunks, we might just grab user inputs for now or simple responses if easily identifiable

            } catch (e) {
                // ignore
            }
        }

        const preview = createPreview(fullContent);

        sessions.push({
            id: path.basename(filePath, '.jsonl'),
            title: firstUserMessage.slice(0, 50) + (firstUserMessage.length > 50 ? '...' : ''),
            preview,
            userPrompts,
            timestamp: mtime,
            source: 'codex',
            path: filePath
        });
    }

    return sessions;
}

// --- Cursor Adapter ---

function getCursorMD5Path(projectPath: string): string {
    return crypto.createHash('md5').update(projectPath).digest('hex');
}

export type CursorDebugInfo = {
    cwd: string;
    resolvedCwd: string;
    projectRoot: string | null;
    projectHash: string | null;
    chatsDir: string | null;
    dbFiles: string[];
};

function decodeMaybeHexJson(hexStr: string): any | null {
    if (!hexStr) return null;
    try {
        const first = Buffer.from(hexStr.trim(), 'hex').toString('utf-8').trim();
        // Cursor meta can be hex-encoded JSON string, then hex-encoded again.
        const isHex = /^[0-9a-fA-F]+$/.test(first);
        const jsonText = isHex ? Buffer.from(first, 'hex').toString('utf-8') : first;
        return JSON.parse(jsonText);
    } catch (e) {
        return null;
    }
}

function sanitizeCursorText(text: string): string {
    return text.replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim();
}

function isLikelyText(text: string): boolean {
    if (!text) return false;
    const replacementCount = (text.match(/\uFFFD/g) || []).length;
    if (replacementCount > 0) return false;
    const total = text.length;
    let ok = 0;
    for (const ch of text) {
        if (/[\p{L}\p{N}\p{P}\p{Zs}]/u.test(ch)) {
            ok++;
        }
    }
    return total > 0 && ok / total >= 0.7;
}

function findCursorProjectRoot(cwd: string, chatsBaseDir: string): string | null {
    const resolved = path.resolve(cwd);
    const hash = getCursorMD5Path(resolved);
    const candidate = path.join(chatsBaseDir, hash);
    return fs.existsSync(candidate) ? resolved : null;
}

export function getCursorDebugInfo(cwd: string): CursorDebugInfo {
    const homeDir = os.homedir();
    const chatsBaseDir = path.join(homeDir, '.cursor', 'chats');
    const resolvedCwd = path.resolve(cwd);
    const projectRoot = findCursorProjectRoot(resolvedCwd, chatsBaseDir);

    if (!projectRoot) {
        return {
            cwd,
            resolvedCwd,
            projectRoot: null,
            projectHash: null,
            chatsDir: null,
            dbFiles: []
        };
    }

    const projectHash = getCursorMD5Path(projectRoot);
    const chatsDir = path.join(chatsBaseDir, projectHash);
    const dbFiles = fs.existsSync(chatsDir)
        ? glob.sync('*/store.db', { cwd: chatsDir, absolute: true })
        : [];

    return {
        cwd,
        resolvedCwd,
        projectRoot,
        projectHash,
        chatsDir,
        dbFiles
    };
}

export async function getCursorSessions(cwd: string, limit: number = 10): Promise<SessionSummary[]> {
    const homeDir = os.homedir();
    const chatsBaseDir = path.join(homeDir, '.cursor', 'chats');
    const projectRoot = findCursorProjectRoot(normalizeCwd(cwd), chatsBaseDir);
    if (!projectRoot) {
        return [];
    }
    const projectHash = getCursorMD5Path(projectRoot);
    // Path: ~/.cursor/chats/<hash>/<session_uuid>/store.db
    const chatsDir = path.join(chatsBaseDir, projectHash);

    if (!fs.existsSync(chatsDir)) {
        return [];
    }

    // Glob for store.db files
    const dbFiles = glob.sync('*/store.db', { cwd: chatsDir, absolute: true });

    // Sort by modification time
    const sortedFiles = dbFiles.map(filePath => ({
        filePath,
        mtime: fs.statSync(filePath).mtimeMs
    }))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit);

    const sessions: SessionSummary[] = [];

    for (const { filePath, mtime } of sortedFiles) {
        try {
            // We need to read the sqlite DB. Assuming sqlite3 CLI is available.
            // If not, we might fail.
            // Query 1: Get Metadata (created_at, name)
            // Table: meta, Key: "0" -> value is JSON hex encoded? No, in my test it was hex string of JSON.
            // Wait, "select * from meta" showed: 0|<hex string>
            // So we select hex(value) where key='0'.

            // Query 2: Get Blobs (messages)
            // Table: blobs, Column: data (BLOB)
            // We select hex(data) to parse in JS.

            // Use .separator to make parsing easier if needed, but hex is continuous.
            // We run two commands or one?
            // Let's run one command to get everything or just iterate.

            // Command: sqlite3 <db> "select hex(value) from meta where key='0'; select '---SPLIT---'; select hex(data) from blobs;"

            // Avoid dumping huge DBs to stdout (ENOBUFS). Limit blobs to a recent slice.
            const cmd = `sqlite3 "${filePath}" "select hex(value) from meta where key='0'; select '---SPLIT---'; select hex(data) from blobs order by rowid desc limit 100;"`;
            const output = execSync(cmd, {
                encoding: 'utf-8',
                stdio: ['ignore', 'pipe', 'ignore'],
                maxBuffer: 10 * 1024 * 1024
            });

            const [metaHex, blobsHex] = output.split('---SPLIT---\n');

            // Parse Meta
            let title = 'New Session';
            let timestamp = mtime;

            if (metaHex && metaHex.trim()) {
                const meta = decodeMaybeHexJson(metaHex);
                if (meta?.name) title = meta.name;
                if (meta?.createdAt) timestamp = meta.createdAt;
            }

            // Parse Blobs
            const userPrompts: string[] = [];
            const blobLines = (blobsHex || '').split('\n').filter(l => l.trim()).reverse();

            for (const hex of blobLines) {
                try {
                    const buffer = Buffer.from(hex.trim(), 'hex');
                    const str = buffer.toString('utf-8');

                    // Check if JSON
                    if (str.startsWith('{')) {
                        try {
                            const json = JSON.parse(str);
                            if (json.role === 'user' && json.content) {
                                let text = '';
                                if (typeof json.content === 'string') {
                                    text = json.content;
                                } else if (Array.isArray(json.content)) {
                                    text = json.content
                                        .filter((c: any) => c.type === 'text' && c.text)
                                        .map((c: any) => c.text)
                                        .join('\n');
                                }

                                // Filter out system/context injections if identifiable
                                // Cursor sometimes injects <user_info> etc.
                                if (text && !text.includes('<user_info>')) {
                                     // Strip <user_query> tags which Cursor adds
                                     text = sanitizeCursorText(text.replace(/<\/?user_query>/g, ''));
                                     if (text && isLikelyText(text)) {
                                         userPrompts.push(text);
                                     }
                                }
                            }
                        } catch (e) {
                            // not json
                        }
                    } else {
                        // Binary format - extract printable strings
                        // Heuristic: Extract strings > 4 chars
                        // And filter out common noise.
                        // The user prompt I saw earlier was: "0A DA 01 ... User Text ... 12 24 UUID"
                        // Simplest approach: "strings" equivalent
                        // Filter for CJK characters or long English sentences.

                        // Let's just strip control chars and see what's left.
                        // But binary data has a lot of noise.
                        // If we assume the format found earlier: 0A [Varint Len] [Text]
                        if (buffer[0] === 0x0A) {
                            // Protobuf field 1
                            let offset = 1;
                            // Parse varint length
                            let len = 0;
                            let shift = 0;
                            while (offset < buffer.length) {
                                const b = buffer[offset];
                                len |= (b & 0x7F) << shift;
                                offset++;
                                shift += 7;
                                if ((b & 0x80) === 0) break;
                            }

                            if (len > 0 && offset + len <= buffer.length) {
                                const text = sanitizeCursorText(
                                    buffer.subarray(offset, offset + len).toString('utf-8')
                                );
                                // Verify it looks like text (not random binary)
                                // If it contains many control chars, ignore.
                                if (text && !/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(text) && isLikelyText(text)) {
                                     userPrompts.push(text);
                                }
                            }
                        }
                    }
                } catch (e) {
                    // ignore
                }
            }

            // Refine title if default
            if (title === 'New Agent' || title === 'New Session') {
                if (userPrompts.length > 0) {
                    title = userPrompts[0];
                }
            }

            const preview = userPrompts.join('\n\n');

            sessions.push({
                id: path.basename(path.dirname(filePath)), // session UUID is parent dir name
                title: title.slice(0, 50) + (title.length > 50 ? '...' : ''),
                preview: createPreview(preview),
                userPrompts,
                timestamp,
                source: 'cursor',
                path: filePath
            });

        } catch (e) {
            // ignore sqlite errors or missing files
        }
    }

    return sessions;
}

// --- Gemini Adapter ---

function getGeminiSHA256Path(projectPath: string): string {
    return crypto.createHash('sha256').update(projectPath).digest('hex');
}

export async function getGeminiSessions(cwd: string, limit: number = 10): Promise<SessionSummary[]> {
    const homeDir = os.homedir();
    const projectHash = getGeminiSHA256Path(normalizeCwd(cwd));
    // Path: ~/.gemini/tmp/<hash>/chats/*.json
    const chatsDir = path.join(homeDir, '.gemini', 'tmp', projectHash, 'chats');

    if (!fs.existsSync(chatsDir)) {
        return [];
    }

    const files = glob.sync('*.json', { cwd: chatsDir, absolute: true });

    // Sort by modification time
    const sortedFiles = files.map(filePath => ({
        filePath,
        mtime: fs.statSync(filePath).mtimeMs
    }))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit);

    const sessions: SessionSummary[] = [];

    for (const { filePath, mtime } of sortedFiles) {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const data = JSON.parse(content);

            // Data format: { messages: [ { type: 'user', content: '...' }, ... ] }
            const userPrompts: string[] = [];
            let title = 'New Session';

            if (data.messages && Array.isArray(data.messages)) {
                for (const msg of data.messages) {
                    if (msg.type === 'user' && msg.content) {
                        let text = '';
                        if (typeof msg.content === 'string') {
                            text = msg.content;
                        } else if (Array.isArray(msg.content)) {
                            text = msg.content.map((c: any) => typeof c === 'string' ? c : (c.text || '')).join(' ');
                        }
                        if (text) {
                            userPrompts.push(text);
                        }
                    }
                }
            }

            if (userPrompts.length > 0) {
                title = userPrompts[0];
            }

            const preview = userPrompts.join('\n\n');

            sessions.push({
                id: path.basename(filePath, '.json'),
                title: title.slice(0, 50) + (title.length > 50 ? '...' : ''),
                preview: createPreview(preview),
                userPrompts,
                timestamp: data.lastUpdated ? new Date(data.lastUpdated).getTime() : mtime,
                source: 'gemini',
                path: filePath
            });

        } catch (e) {
            // ignore
        }
    }

    return sessions;
}
