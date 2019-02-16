import * as https from "https";
import * as vs from "vscode";

let updateDecorationsTimer: NodeJS.Timer | undefined;
const githubUrlDecoration = vs.window.createTextEditorDecorationType({
	rangeBehavior: vs.DecorationRangeBehavior.ClosedClosed,

});

export function activate(context: vs.ExtensionContext) {
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

function getIssue(owner: string, repo: string, issue: number): Promise<GitHubIssue> {
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
	// TODO: This
	lines.push(`**Updated:** x days ago...`);
	lines.push("\n---\n");
	lines.push(`${issue.body}`);
	return lines.join("\n");
}

interface GitHubIssue {
	assignees: string[];
	body: string;
	labels: Array<{ name: string, color: string }>;
	state: "open" | "closed";
	title: string;
	updated_at: string;
}
