import React, { useState, useEffect } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import SelectInput from 'ink-select-input';
import { SessionSummary, getClaudeSessions, getCodexSessions, getCursorSessions, getGeminiSessions } from '../adapters/index.js';
import stringWidth from 'string-width';

interface Item {
	label: string;
	value: string;
	session: SessionSummary;
}

// Truncate by display width (handles CJK characters correctly)
const truncateByWidth = (str: string, maxWidth: number): string => {
	if (stringWidth(str) <= maxWidth) return str;

	let result = '';
	let width = 0;

	for (const char of str) {
		const charWidth = stringWidth(char);
		if (width + charWidth > maxWidth) break;
		result += char;
		width += charWidth;
	}

	return result + '...';
};

const App = ({
	cwd,
	limit = 10,
	onSubmit
}: {
	cwd: string;
	limit?: number;
	onSubmit?: (output: string) => void;
}) => {
	const [claudeItems, setClaudeItems] = useState<Item[]>([]);
	const [codexItems, setCodexItems] = useState<Item[]>([]);
	const [cursorItems, setCursorItems] = useState<Item[]>([]);
	const [geminiItems, setGeminiItems] = useState<Item[]>([]);

	const [activePanel, setActivePanel] = useState<'claude' | 'codex' | 'cursor' | 'gemini'>('claude');
	const [activeClaudeItem, setActiveClaudeItem] = useState<Item | null>(null);
	const [activeCodexItem, setActiveCodexItem] = useState<Item | null>(null);
	const [activeCursorItem, setActiveCursorItem] = useState<Item | null>(null);
	const [activeGeminiItem, setActiveGeminiItem] = useState<Item | null>(null);

	const { exit } = useApp();

	// Tab switching and Arrow Navigation
	useInput((input, key) => {
		if (key.tab) {
			const panels: ('claude' | 'codex' | 'cursor' | 'gemini')[] = ['claude', 'codex', 'cursor', 'gemini'];
			const currentIndex = panels.indexOf(activePanel);
			const nextIndex = (currentIndex + 1) % panels.length;
			setActivePanel(panels[nextIndex]);
		}

		// Helper to get current list state
		const getCurrentState = () => {
			switch (activePanel) {
				case 'claude': return { items: claudeItems, active: activeClaudeItem };
				case 'codex': return { items: codexItems, active: activeCodexItem };
				case 'cursor': return { items: cursorItems, active: activeCursorItem };
				case 'gemini': return { items: geminiItems, active: activeGeminiItem };
				default: return { items: [], active: null };
			}
		};

		const { items, active } = getCurrentState();
		const currentIndex = items.findIndex(i => i.value === active?.value);

		// Arrow Navigation Logic
		if (key.leftArrow) {
			if (activePanel === 'codex') setActivePanel('claude');
			if (activePanel === 'gemini') setActivePanel('cursor');
		}
		if (key.rightArrow) {
			if (activePanel === 'claude') setActivePanel('codex');
			if (activePanel === 'cursor') setActivePanel('gemini');
		}
		if (key.upArrow) {
			// If at top of list (index 0) or empty list, switch to panel above
			if (currentIndex <= 0) {
				if (activePanel === 'cursor') setActivePanel('claude');
				if (activePanel === 'gemini') setActivePanel('codex');
			}
		}
		if (key.downArrow) {
			// If at bottom of list or empty list, switch to panel below
			if (items.length === 0 || currentIndex === items.length - 1) {
				if (activePanel === 'claude') setActivePanel('cursor');
				if (activePanel === 'codex') setActivePanel('gemini');
			}
		}

		if (key.escape) {
			exit();
		}
	});

	useEffect(() => {
		const loadSessions = async () => {
			const [claudeSessions, codexSessions, cursorSessions, geminiSessions] = await Promise.all([
				getClaudeSessions(cwd, limit),
				getCodexSessions(cwd, limit),
				getCursorSessions(cwd, limit),
				getGeminiSessions(cwd, limit)
			]);

			// Sort by timestamp desc
			const sortFn = (a: SessionSummary, b: SessionSummary) => b.timestamp - a.timestamp;

			const createItems = (sessions: SessionSummary[]) => sessions.sort(sortFn).map(s => {
				const title = s.title.replace(/\n/g, ' ').trim();
				const truncatedTitle = truncateByWidth(title, 30); // Shorter title for grid
				return {
					label: `${truncatedTitle} (${new Date(s.timestamp).toLocaleDateString()})`,
					value: s.id,
					session: s
				};
			});

			const cItems = createItems(claudeSessions);
			const cxItems = createItems(codexSessions);
			const curItems = createItems(cursorSessions);
			const gemItems = createItems(geminiSessions);

			setClaudeItems(cItems);
			setCodexItems(cxItems);
			setCursorItems(curItems);
			setGeminiItems(gemItems);

			if (cItems.length > 0) setActiveClaudeItem(cItems[0]);
			if (cxItems.length > 0) setActiveCodexItem(cxItems[0]);
			if (curItems.length > 0) setActiveCursorItem(curItems[0]);
			if (gemItems.length > 0) setActiveGeminiItem(gemItems[0]);
		};

		loadSessions();
	}, [cwd, limit]);

	const handleSelect = (item: any) => {
		const selectedItem = item as Item;
		const englishPrompt = `Here's a context file ${selectedItem.session.path} from the user's previous operations. Analyze what the user was doing. Then use TodoWrite to list what might be incomplete, and what needs to be done next (if mentioned in the context), otherwise wait for user instructions.`;
		const chinesePrompt = `这里有份上下文 ${selectedItem.session.path} ，是用户曾经的操作。你分析下用户在做什么。然后用TodoWrite列出可能没做完的事情，和接下来要的事情（如果上下文中有提到），如果没有就等待用户指令。`;

		const output = `\n\n${englishPrompt}\n\n${chinesePrompt}\n\n`;

		onSubmit?.(output);
		exit();
	};

	const handleHighlightClaude = (item: any) => setActiveClaudeItem(item as Item);
	const handleHighlightCodex = (item: any) => setActiveCodexItem(item as Item);
	const handleHighlightCursor = (item: any) => setActiveCursorItem(item as Item);
	const handleHighlightGemini = (item: any) => setActiveGeminiItem(item as Item);

	// Get current preview prompts
	let currentItem: Item | null = null;
	if (activePanel === 'claude') currentItem = activeClaudeItem;
	else if (activePanel === 'codex') currentItem = activeCodexItem;
	else if (activePanel === 'cursor') currentItem = activeCursorItem;
	else if (activePanel === 'gemini') currentItem = activeGeminiItem;

	// Filter out empty prompts
	const prompts = (currentItem?.session.userPrompts || []).filter(p => p && p.trim().length > 0);

	// Truncate prompts logic (~60 display width: ~120 ASCII chars or ~60 CJK chars)
	const previewText = prompts.map((p, i) => {
		const clean = p.replace(/\n/g, ' ').trim();
		const truncated = truncateByWidth(clean, 120);
		return `${i + 1}. ${truncated}`;
	}).join('\n');

	const renderPanel = (title: string, panelId: string, items: Item[], onHighlight: (item: any) => void) => (
		<Box width="50%" borderStyle={activePanel === panelId ? 'double' : 'single'} flexDirection="column" borderColor={activePanel === panelId ? 'green' : 'white'} paddingX={1}>
			<Text bold underline color={activePanel === panelId ? 'green' : 'white'}>{title}</Text>
			{items.length === 0 ? (
				<Text>No sessions found.</Text>
			) : (
				<SelectInput
					items={items}
					onSelect={handleSelect}
					onHighlight={onHighlight}
					isFocused={activePanel === panelId}
					limit={limit} // Use the limit passed as prop
				/>
			)}
		</Box>
	);

	return (
		<Box flexDirection="column">
			{/* Top Area: Preview */}
			<Box borderStyle="single" flexDirection="column" paddingX={1} minHeight={5}>
				<Text bold underline>Preview (User Prompts)</Text>
				<Text>{previewText || 'Select a session to view prompts'}</Text>
			</Box>

			{/* Middle Area: Row 1 */}
			<Box flexDirection="row">
				{renderPanel('Claude Sessions', 'claude', claudeItems, handleHighlightClaude)}
				{renderPanel('Codex Sessions', 'codex', codexItems, handleHighlightCodex)}
			</Box>

			{/* Bottom Area: Row 2 */}
			<Box flexDirection="row">
				{renderPanel('Cursor Sessions', 'cursor', cursorItems, handleHighlightCursor)}
				{renderPanel('Gemini Sessions', 'gemini', geminiItems, handleHighlightGemini)}
			</Box>

			<Box marginTop={0}>
				<Text dimColor>TAB: Switch Panel | Arrows: Nav | ENTER: Select | ESC: Exit</Text>
			</Box>
		</Box>
	);
};

export default App;
