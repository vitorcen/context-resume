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
	const [items, setItems] = useState<Item[]>([]);
    const [activeItem, setActiveItem] = useState<Item | null>(null);
    const { exit } = useApp();

	useEffect(() => {
		const loadSessions = async () => {
            const [claudeSessions, codexSessions] = await Promise.all([
                getClaudeSessions(cwd, limit),
                getCodexSessions(cwd, limit)
            ]);

            // Merge and sort by timestamp desc (up to limit * 2 total)
            const allSessions = [...claudeSessions, ...codexSessions]
                .sort((a, b) => b.timestamp - a.timestamp)
                .slice(0, limit * 2);

            const listItems = allSessions.map(s => ({
                label: `[${s.source.toUpperCase()}] ${s.title} (${new Date(s.timestamp).toLocaleDateString()})`,
                value: s.id,
                session: s
            }));

            setItems(listItems);
            if (listItems.length > 0) {
                setActiveItem(listItems[0]);
            }
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

    const handleHighlight = (item: any) => {
        const selectedItem = item as Item;
        setActiveItem(selectedItem);
    };

	return (
		<Box flexDirection="row" height={20}>
			<Box width="50%" borderStyle="single" flexDirection="column">
                <Text bold underline>History Sessions</Text>
                {items.length === 0 ? (
                    <Text>Loading or no history found...</Text>
                ) : (
                    <SelectInput
                        items={items}
                        onSelect={handleSelect}
                        onHighlight={handleHighlight}
                    />
                )}
			</Box>
			<Box width="50%" borderStyle="single" flexDirection="column" paddingX={1}>
				<Text bold underline>Preview</Text>
                <Text>{activeItem?.session.preview || 'Select a session to view preview'}</Text>
			</Box>
		</Box>
	);
};

export default App;
