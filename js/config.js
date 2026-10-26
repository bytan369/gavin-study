/*
 * Supabase 云同步配置。
 * 在 Supabase 控制台 Project Settings → API 中找到 Project URL 和 anon / publishable key 填在下面。
 * anon key 是公开的前端密钥，数据由行级安全策略（RLS）保护，可以提交到仓库。
 * 留空则只保存在本机。也可以不改这个文件，改用 GitHub 仓库变量（见 README）。
 */
window.STUDY_CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: '',
};
