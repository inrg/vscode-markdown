'use strict';

import { commands, env, ExtensionContext, Position, Range, Selection, TextEditor, window, workspace, WorkspaceEdit } from 'vscode';

export function activate(context: ExtensionContext) {
    context.subscriptions.push(
        commands.registerCommand('markdown.extension.editing.toggleBold', toggleBold),
        commands.registerCommand('markdown.extension.editing.toggleItalic', toggleItalic),
        commands.registerCommand('markdown.extension.editing.toggleCodeSpan', toggleCodeSpan),
        commands.registerCommand('markdown.extension.editing.toggleStrikethrough', toggleStrikethrough),
        commands.registerCommand('markdown.extension.editing.toggleMath', toggleMath),
        commands.registerCommand('markdown.extension.editing.toggleHeadingUp', toggleHeadingUp),
        commands.registerCommand('markdown.extension.editing.toggleHeadingDown', toggleHeadingDown),
        commands.registerCommand('markdown.extension.editing.toggleUnorderedList', toggleUnorderedList),
        commands.registerCommand('markdown.extension.editing.paste', paste)
    );
}

// Return Promise because need to chain operations in unit tests

function toggleBold() {
    return styleByWrapping('**');
}

function toggleItalic() {
    let indicator = workspace.getConfiguration('markdown.extension.italic').get<string>('indicator');
    return styleByWrapping(indicator);
}

function toggleCodeSpan() {
    return styleByWrapping('`');
}

function toggleStrikethrough() {
    return styleByWrapping('~~');
}

async function toggleHeadingUp() {
    let editor = window.activeTextEditor;
    let lineIndex = editor.selection.active.line;
    let lineText = editor.document.lineAt(lineIndex).text;

    return await editor.edit((editBuilder) => {
        if (!lineText.startsWith('#')) { // Not a heading
            editBuilder.insert(new Position(lineIndex, 0), '# ');
        }
        else if (!lineText.startsWith('######')) { // Already a heading (but not level 6)
            editBuilder.insert(new Position(lineIndex, 0), '#');
        }
    });
}

function toggleHeadingDown() {
    let editor = window.activeTextEditor;
    let lineIndex = editor.selection.active.line;
    let lineText = editor.document.lineAt(lineIndex).text;

    editor.edit((editBuilder) => {
        if (lineText.startsWith('# ')) { // Heading level 1
            editBuilder.delete(new Range(new Position(lineIndex, 0), new Position(lineIndex, 2)));
        }
        else if (lineText.startsWith('#')) { // Heading (but not level 1)
            editBuilder.delete(new Range(new Position(lineIndex, 0), new Position(lineIndex, 1)));
        }
    });
}

function toggleMath() {
    let editor = window.activeTextEditor;
    if (!editor.selection.isEmpty) return;
    let cursor = editor.selection.active;

    if (getContext(editor, cursor, '$') === '$|$') {
        return editor.edit(editBuilder => {
            editBuilder.replace(new Range(cursor.line, cursor.character - 1, cursor.line, cursor.character + 1), '$$  $$');
        }).then(() => {
            let pos = cursor.with({ character: cursor.character + 2 });
            editor.selection = new Selection(pos, pos);
        });
    } else if (getContext(editor, cursor, '$$ ', ' $$') === '$$ | $$') {
        return editor.edit(editBuilder => {
            editBuilder.delete(new Range(cursor.line, cursor.character - 3, cursor.line, cursor.character + 3));
        });
    } else {
        return commands.executeCommand('editor.action.insertSnippet', { snippet: '$$0$' });
    }
}

function toggleUnorderedList() {
    let editor = window.activeTextEditor;
    if (!editor.selection.isEmpty) return;
    let cursor = editor.selection.active;
    let textBeforeCursor = editor.document.lineAt(cursor.line).text.substr(0, cursor.character);

    let indentation = 0;
    switch (textBeforeCursor.trim()) {
        case '':
            return editor.edit(editBuilder => {
                editBuilder.insert(cursor, '- ');
            });
        case '-':
            indentation = textBeforeCursor.indexOf('-');
            return editor.edit(editBuilder => {
                editBuilder.replace(new Range(cursor.line, indentation, cursor.line, cursor.character), '*' + ' '.repeat(textBeforeCursor.length - indentation - 1));
            });
        case '*':
            indentation = textBeforeCursor.indexOf('*');
            return editor.edit(editBuilder => {
                editBuilder.replace(new Range(cursor.line, indentation, cursor.line, cursor.character), '+' + ' '.repeat(textBeforeCursor.length - indentation - 1));
            });
        case '+':
            indentation = textBeforeCursor.indexOf('+');
            return editor.edit(editBuilder => {
                editBuilder.delete(new Range(cursor.line, indentation, cursor.line, cursor.character));
            });
    }
}

async function paste() {
    if (window.activeTextEditor.selection.isSingleLine) {
        const text = await env.clipboard.readText();
        if (/^((([A-Za-z]{3,9}:(?:\/\/)?)(?:[-;:&=\+\$,\w]+@)?[A-Za-z0-9.-]+|(?:www.|[-;:&=\+\$,\w]+@)[A-Za-z0-9.-]+)((?:\/[\+~%\/.\w-_]*)?\??(?:[-\+=&;%@.\w_]*)#?(?:[\w]*))?)$/.test(text)) {
            return commands.executeCommand("editor.action.insertSnippet", { "snippet": `[$TM_SELECTED_TEXT$0](${text})` });
        }
    }
    return commands.executeCommand("editor.action.clipboardPasteAction");
}

function styleByWrapping(startPattern, endPattern?) {
    if (endPattern == undefined) {
        endPattern = startPattern;
    }

    let editor = window.activeTextEditor;
    let selections = editor.selections;

    let batchEdit = new WorkspaceEdit();
    let shifts: [Position, number][] = [];
    let newSelections: Selection[] = selections.slice();

    selections.forEach((selection, i) => {

        let cursorPos = selection.active;
        const shift = shifts.map(([pos, s]) => (selection.start.line == pos.line && selection.start.character >= pos.character) ? s : 0)
            .reduce((a, b) => a + b, 0);

        if (selection.isEmpty) {
            // No selected text
            if (startPattern !== '~~' && getContext(editor, cursorPos, startPattern) === `${startPattern}text|${endPattern}`) {
                // `**text|**` to `**text**|`
                let newCursorPos = cursorPos.with({ character: cursorPos.character + shift + endPattern.length });
                newSelections[i] = new Selection(newCursorPos, newCursorPos);
                return;
            } else if (getContext(editor, cursorPos, startPattern) === `${startPattern}|${endPattern}`) {
                // `**|**` to `|`
                let start = cursorPos.with({ character: cursorPos.character - startPattern.length });
                let end = cursorPos.with({ character: cursorPos.character + endPattern.length });
                wrapRange(editor, batchEdit, shifts, newSelections, i, shift, cursorPos, new Range(start, end), false, startPattern);
            } else {
                // Select word under cursor
                let wordRange = editor.document.getWordRangeAtPosition(cursorPos);
                if (wordRange == undefined) {
                    wordRange = selection;
                }
                // One special case: toggle strikethrough in task list
                const currentTextLine = editor.document.lineAt(cursorPos.line);
                if (startPattern === '~~' && /^\s*[\*\+\-] (\[[ x]\] )? */g.test(currentTextLine.text)) {
                    wordRange = currentTextLine.range.with(new Position(cursorPos.line, currentTextLine.text.match(/^\s*[\*\+\-] (\[[ x]\] )? */g)[0].length));
                }
                wrapRange(editor, batchEdit, shifts, newSelections, i, shift, cursorPos, wordRange, false, startPattern);
            }
        } else {
            // Text selected
            wrapRange(editor, batchEdit, shifts, newSelections, i, shift, cursorPos, selection, true, startPattern);
        }
    });

    return workspace.applyEdit(batchEdit).then(() => {
        editor.selections = newSelections;
    });
}

/**
 * Add or remove `startPattern`/`endPattern` according to the context
 * @param editor 
 * @param options The undo/redo behavior
 * @param cursor cursor position
 * @param range range to be replaced
 * @param isSelected is this range selected
 * @param startPtn 
 * @param endPtn 
 */
function wrapRange(editor: TextEditor, wsEdit: WorkspaceEdit, shifts: [Position, number][], newSelections: Selection[], i: number, shift: number, cursor: Position, range: Range, isSelected: boolean, startPtn: string, endPtn?: string) {
    if (endPtn == undefined) {
        endPtn = startPtn;
    }

    let text = editor.document.getText(range);
    const prevSelection = newSelections[i];
    const ptnLength = (startPtn + endPtn).length;

    let newCursorPos = cursor.with({ character: cursor.character + shift });
    let newSelection: Selection;
    if (isWrapped(text, startPtn)) {
        // remove start/end patterns from range
        wsEdit.replace(editor.document.uri, range, text.substr(startPtn.length, text.length - ptnLength));

        shifts.push([range.end, -ptnLength]);

        // Fix cursor position
        if (!isSelected) {
            if (!range.isEmpty) { // means quick styling
                if (cursor.character == range.end.character) {
                    newCursorPos = cursor.with({ character: cursor.character + shift - ptnLength });
                } else {
                    newCursorPos = cursor.with({ character: cursor.character + shift - startPtn.length });
                }
            } else { // means `**|**` -> `|`
                newCursorPos = cursor.with({ character: cursor.character + shift + startPtn.length });
            }
            newSelection = new Selection(newCursorPos, newCursorPos);
        } else {
            newSelection = new Selection(
                prevSelection.start.with({ character: prevSelection.start.character + shift }),
                prevSelection.end.with({ character: prevSelection.end.character + shift - ptnLength })
            );
        }
    } else {
        // add start/end patterns around range
        wsEdit.replace(editor.document.uri, range, startPtn + text + endPtn);

        shifts.push([range.end, ptnLength]);

        // Fix cursor position
        if (!isSelected) {
            if (!range.isEmpty) { // means quick styling
                if (cursor.character == range.end.character) {
                    newCursorPos = cursor.with({ character: cursor.character + shift + ptnLength });
                } else {
                    newCursorPos = cursor.with({ character: cursor.character + shift + startPtn.length });
                }
            } else { // means `|` -> `**|**`
                newCursorPos = cursor.with({ character: cursor.character + shift + startPtn.length });
            }
            newSelection = new Selection(newCursorPos, newCursorPos);
        } else {
            newSelection = new Selection(
                prevSelection.start.with({ character: prevSelection.start.character + shift }),
                prevSelection.end.with({ character: prevSelection.end.character + shift + ptnLength })
            );
        }
    }

    newSelections[i] = newSelection;
}

function isWrapped(text, startPattern, endPattern?): boolean {
    if (endPattern == undefined) {
        endPattern = startPattern;
    }
    return text.startsWith(startPattern) && text.endsWith(endPattern);
}

function getContext(editor, cursorPos, startPattern, endPattern?): string {
    if (endPattern == undefined) {
        endPattern = startPattern;
    }

    let startPositionCharacter = cursorPos.character - startPattern.length;
    let endPositionCharacter = cursorPos.character + endPattern.length;

    if (startPositionCharacter < 0) {
        startPositionCharacter = 0;
    }

    let leftText = editor.document.getText(new Range(cursorPos.line, startPositionCharacter, cursorPos.line, cursorPos.character));
    let rightText = editor.document.getText(new Range(cursorPos.line, cursorPos.character, cursorPos.line, endPositionCharacter));

    if (rightText == endPattern) {
        if (leftText == startPattern) {
            return `${startPattern}|${endPattern}`;
        } else {
            return `${startPattern}text|${endPattern}`;
        }
    }
    return '|';
}
