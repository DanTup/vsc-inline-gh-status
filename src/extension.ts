import * as https from "https";
import * as vs from "vscode";

const cacheDurationMs = 1000 * 60 * 60 * 24; // 24 hours
// TODO: This is dirty (will get worse with strictNulls), move everything out to
// a class that takes this in constructor ?
let context: vs.ExtensionContext;

let updateDecorationsTimer: NodeJS.Timer | undefined;
const githubUrlDecoration = vs.window.createTextEditorDecorationType({
	rangeBehavior: vs.DecorationRangeBehavior.ClosedClosed,

});

export function activate(ctx: vs.ExtensionContext) {
	context = ctx;
	vs.window.onDidChangeActiveTextEditor(triggerUpdateDecorations, null, context.subscriptions);
	triggerUpdateDecorations();

	// vscode.workspace.onDidChangeTextDocument(event => {
	// 	if (activeEditor && event.document === activeEditor.document) {
	// 		triggerUpdateDecorations();
	// 	}
	// }, null, context.subscriptions);
}

function triggerUpdateDecorations() {
	if (updateDecorationsTimer) {
		clearTimeout(updateDecorationsTimer);
	}
	updateDecorationsTimer = setTimeout(updateDecorations, 500);
}

async function updateDecorations(): Promise<void> {
	const editor = vs.window.activeTextEditor;
	if (!editor)
		return;

	const githubIssuePattern = /github\.com\/([a-z\-\d]+)\/([a-z\-\d]+)\/issues\/(\d+)/gi;
	const text = editor.document.getText();
	const decorations: vs.DecorationOptions[] = [];
	let match;
	while (match = githubIssuePattern.exec(text)) {
		try {
			// TODO: Caching
			const issue = await getIssue(match[1], match[2], parseInt(match[3], 10));
			const isOpen = issue.state === "open";

			const startPos = editor.document.positionAt(match.index);
			const endPos = editor.document.positionAt(match.index + match[0].length);
			const decoration: vs.DecorationOptions = {
				hoverMessage: getHover(issue),
				range: new vs.Range(startPos, endPos),
				renderOptions: {
					after: {
						backgroundColor: isOpen ? "#2cbe4e" : "#cb2431",
						color: "#ffffff",
						contentText: isOpen ? "Open" : "Closed",
						fontWeight: "600",
						margin: "0 0 0 5px",
					},
				},
			};
			decorations.push(decoration);
		} catch (e) {
			// TODO: ...
		}
	}
	editor.setDecorations(githubUrlDecoration, decorations);
}

async function getIssue(owner: string, repo: string, issue: number): Promise<GitHubIssue> {
	const key = `issue/${owner}/${repo}/${issue}`;
	const cachedItem = await getCachedItem<GitHubIssue>(key);
	console.info(cachedItem ? `Got ${key} from cache` : `Item ${key} not cached`);
	if (cachedItem && cachedItem.cachedDate > Date.now() - cacheDurationMs) {
		console.info(`Using cache for ${key}`);
		return cachedItem.item;
	}
	console.info(`Cache for ${key} is stale, fetching from web...`);
	const liveItem = await getIssueFromGitHubApi(owner, repo, issue);
	cacheItem(key, new CachedData(liveItem, Date.now()));
	return liveItem;
}

function getCachedItem<T>(key: string): CachedData<T> | undefined {
	return context.globalState.get(key);
}

function cacheItem<T>(key: string, item: CachedData<T>): void {
	context.globalState.update(key, item);
}

function getIssueFromGitHubApi(owner: string, repo: string, issue: number): Promise<GitHubIssue> {
	return new Promise<GitHubIssue>((resolve, reject) => {
		const options: https.RequestOptions = {
			headers: {
				"user-agent": "DanTup-vsc-inline-gh-status",
			},
			hostname: "api.github.com",
			method: "GET",
			path: `/repos/${owner}/${repo}/issues/${issue}`,
			port: 443,
		};

		const req = https.request(options, (resp) => {
			if (!resp || !resp.statusCode || resp.statusCode < 200 || resp.statusCode > 300) {
				reject({ message: `Failed to get issue: ${resp && resp.statusCode}: ${resp && resp.statusMessage}` });
			} else {
				const chunks: string[] = [];
				resp.on("data", (b) => chunks.push(b.toString()));
				resp.on("end", () => {
					const json = chunks.join("");
					resolve(JSON.parse(json));
				});
			}
		});
		req.end();
	});
}

function getHover(issue: GitHubIssue) {
	const lines: string[] = [];
	lines.push(`**${issue.title}**\n`);
	if (issue.labels && issue.labels.length) {
		lines.push(`${issue.labels.map((l) => l.name).join(", ")}`);
	}
	const dateString = getDateString(Date.parse(issue.updated_at));

	lines.push(`**Updated:** ${dateString}`);
	lines.push("\n---\n");
	lines.push(`${issue.body}`);
	return lines.join("\n");
}

function getDateString(date: number) {
	const now = new Date(Date.now());
	const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
	const msAgo = endOfToday - date;
	const daysAgo = Math.floor(msAgo / (1000 * 60 * 60 * 24));

	if (daysAgo === 0) {
		return "today";
	} else if (daysAgo === 1) {
		return "yesterday";
	} else {
		return `${daysAgo} days ago`;
	}
}

interface GitHubIssue {
	assignees: string[];
	body: string;
	labels: Array<{ name: string, color: string }>;
	state: "open" | "closed";
	title: string;
	updated_at: string;
}

class CachedData<T> {
	constructor(public readonly item: T, public readonly cachedDate: number) { }
}
