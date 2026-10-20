// 随机短 id（对局 id、存档状态令牌等）：时间戳 + 随机数，36 进制。
export const randomId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
