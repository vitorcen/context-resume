import React, { useState, useEffect } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import SelectInput from 'ink-select-input';
import { SessionSummary, getClaudeSessions, getCodexSessions } from '../adapters/index.js';

interface Item {
	label: string;
	value: string;
    session: SessionSummary;
}

const App = ({ cwd, limit = 10 }: { cwd: string; limit?: number }) => {
	const [claudeItems, setClaudeItems] = useState<Item[]>([]);
    const [codexItems, setCodexItems] = useState<Item[]>([]);

    const [activePanel, setActivePanel] = useState<'claude' | 'codex'>('claude');
    const [activeClaudeItem, setActiveClaudeItem] = useState<Item | null>(null);
    const [activeCodexItem, setActiveCodexItem] = useState<Item | null>(null);

    const { exit } = useApp();

    // Tab switching and Arrow Navigation
    useInput((input, key) => {
        if (key.tab) {
            setActivePanel(prev => prev === 'claude' ? 'codex' : 'claude');
        }
        if (key.leftArrow && activePanel === 'codex') {
            setActivePanel('claude');
        }
        if (key.rightArrow && activePanel === 'claude') {
            setActivePanel('codex');
        }
    });

	useEffect(() => {
		const loadSessions = async () => {
            const [claudeSessions, codexSessions] = await Promise.all([
                getClaudeSessions(cwd, limit),
                getCodexSessions(cwd, limit)
            ]);

            // Sort by timestamp desc
            const sortFn = (a: SessionSummary, b: SessionSummary) => b.timestamp - a.timestamp;

            const cItems = claudeSessions.sort(sortFn).map(s => ({
                label: `${s.title} (${new Date(s.timestamp).toLocaleDateString()})`,
                value: s.id,
                session: s
            }));

            const cxItems = codexSessions.sort(sortFn).map(s => ({
                label: `${s.title} (${new Date(s.timestamp).toLocaleDateString()})`,
                value: s.id,
                session: s
            }));

            setClaudeItems(cItems);
            setCodexItems(cxItems);

            if (cItems.length > 0) setActiveClaudeItem(cItems[0]);
            if (cxItems.length > 0) setActiveCodexItem(cxItems[0]);
		};

		loadSessions();
	}, [cwd, limit]);

    const handleSelect = (item: any) => {
        const selectedItem = item as Item;
        const englishPrompt = `Here's a context file ${selectedItem.session.path} from the user's previous operations. Analyze what the user was doing. Then use TodoWrite to list what might be incomplete, and what needs to be done next (if mentioned in the context), otherwise wait for user instructions.`;
        const chinesePrompt = `这里有份上下文 ${selectedItem.session.path} ，是用户曾经的操作。你分析下用户在做什么。然后用TodoWrite列出可能没做完的事情，和接下来要的事情（如果上下文中有提到），如果没有就等待用户指令。`;

        const output = `\n\n${englishPrompt}\n\n${chinesePrompt}\n\n`;

        process.stdout.write(output);
        exit();
    };

    const handleHighlightClaude = (item: any) => setActiveClaudeItem(item as Item);
    const handleHighlightCodex = (item: any) => setActiveCodexItem(item as Item);

    // Get current preview prompts
    const currentItem = activePanel === 'claude' ? activeClaudeItem : activeCodexItem;
    // Filter out empty prompts
    const prompts = (currentItem?.session.userPrompts || []).filter(p => p && p.trim().length > 0);

    // Truncate prompts logic
    const previewText = prompts.map((p, i) => {
        const clean = p.replace(/\n/g, ' ').trim();
        const truncated = clean.length > 50 ? clean.slice(0, 50) + '...' : clean;
        return `${i + 1}. ${truncated}`;
    }).join('\n');

	return (
		<Box flexDirection="column" height={35}>
            {/* Top Area: Preview */}
			<Box height={12} borderStyle="single" flexDirection="column" paddingX={1}>
				<Text bold underline>Preview (User Prompts)</Text>
                <Text>{previewText || 'Select a session to view prompts'}</Text>
			</Box>

            {/* Bottom Area: Split Panels */}
            <Box flexDirection="row" height={20}>
                {/* Claude Panel */}
                <Box width="50%" borderStyle={activePanel === 'claude' ? 'double' : 'single'} flexDirection="column" borderColor={activePanel === 'claude' ? 'green' : 'white'}>
                    <Text bold underline color={activePanel === 'claude' ? 'green' : 'white'}>Claude Sessions</Text>
                    {claudeItems.length === 0 ? (
                        <Text>No sessions found.</Text>
                    ) : (
                        <SelectInput
                            items={claudeItems}
                            onSelect={handleSelect}
                            onHighlight={handleHighlightClaude}
                            isFocused={activePanel === 'claude'}
                        />
                    )}
                </Box>

                {/* Codex Panel */}
                <Box width="50%" borderStyle={activePanel === 'codex' ? 'double' : 'single'} flexDirection="column" borderColor={activePanel === 'codex' ? 'green' : 'white'}>
                    <Text bold underline color={activePanel === 'codex' ? 'green' : 'white'}>Codex Sessions</Text>
                    {codexItems.length === 0 ? (
                        <Text>No sessions found.</Text>
                    ) : (
                        <SelectInput
                            items={codexItems}
                            onSelect={handleSelect}
                            onHighlight={handleHighlightCodex}
                            isFocused={activePanel === 'codex'}
                        />
                    )}
                </Box>
            </Box>

            <Box marginTop={0}>
                <Text dimColor>TAB/Arrows: Switch Panel | ENTER: Select | ESC: Exit</Text>
            </Box>
		</Box>
	);
};

export default App;
