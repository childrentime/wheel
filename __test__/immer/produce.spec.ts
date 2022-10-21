import produce from "../../src/immer";

describe("immer", () => {
  it("produce api", () => {
    const baseState = [
      {
        title: "Learn TypeScript",
        done: true,
      },
      {
        title: "Try Immer",
        done: false,
      },
    ];

    const nextState = produce(baseState, (draft) => {
      debugger;
      draft[1].done = true;
      draft.push({ title: "Tweet about it", done: false });
    });

    expect(nextState[0] === baseState[0]).toBe(true);
    expect(nextState[1] === baseState[1]).toBe(false);
    expect(nextState[1].done).toBe(true);
    expect(nextState[2]).toStrictEqual({
      title: "Tweet about it",
      done: false,
    });
  });
});
