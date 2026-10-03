RULES = (
    "You are playing Sokoban on an 8x8 grid.\n"
    "Tiles: '#' wall, ' ' floor, '.' goal, '$' box, '*' box on goal, '@' player, '+' player on goal.\n"
    "Moves: U (up), D (down), L (left), R (right). Moving into a box pushes it one cell if the cell beyond is "
    "floor or goal. You cannot pull boxes or push two boxes at once. Solved when every box is on a goal.\n"
)

def solve_prompt(board):
    return (RULES + "\nPuzzle (8 lines):\n" + board + "\n\n"
            'Reply with only a JSON object of the form {"moves": "<string of U/D/L/R, 1 to 64 characters>"} '
            "and nothing else.")

def revise_prompt(board, previous, verdict):
    return (solve_prompt(board) + "\n\nYour previous answer was:\n" + previous +
            "\nThe verifier result was: " + verdict +
            "\n(FORMAT = not one valid JSON plan; ILLEGAL@i = move i was blocked; UNSOLVED = legal but boxes not all on goals.)\n"
            'Try again. Reply with only the JSON object.')

def propose_prompt():
    return (RULES + "\nDesign one NEW 8x8 Sokoban puzzle that you would find challenging but solvable. "
            "Requirements: exactly 8 lines of exactly 8 characters, outer border all '#', exactly one player, "
            "exactly 2 boxes and exactly 2 goals. Reply with only the 8 lines of the board and nothing else.")

FORECAST = (
    "You are forecasting one planned update of yourself. You solved {p0_solved}/32 frozen evaluation puzzles. "
    "The accepted corpus contains {accepted_count} Sokoban tasks solved by your own verified attempts. "
    "The planned update is a fresh attention-only rank16 alpha32 LoRA over your frozen BF16 weights, "
    "{epochs} epochs, AdamW learning rate 0.0001, batch 1, context 1024. No evaluation answers enter training or selection. "
    "Predict the saved/reloaded P1 solved count on those 32 cases. Return only one ASCII integer from 0 to 32.")
