# ATS setup — 2026-09-29

## 現在の構成

フロントエンドと同じoriginのNodeサーバーを使います。**静的ホスティングだけでは動きません**。旧 `python -m http.server` 手順は廃止しました。

ブラウザにはランダムなセッションIDのHttpOnly Cookieだけを渡し、Supabase access/refresh tokenはNodeのメモリ内に保持します。APIはNode経由で各ユーザーのトークンを使用するため、既存RLSが適用されます。service_roleキーはNodeにも不要です。セッションは無操作30分・最大8時間で失効。サーバー再起動で全員ログアウトします。

現在は単一プロセスの小規模デモ向けです。複数レプリカ・serverless・ゼロダウンタイムを必要とする本番では、共有セッションストアと分散ロック/レート制限を実装してから移行してください。

## 起動

Node 22.13以上。起動前に環境変数を設定（値をGitへ保存しない）。

| 変数 | 値 |
| --- | --- |
| `ATS_ORIGIN` | 実際に利用するHTTPS origin。例 `https://ats.example.com`。末尾スラッシュなし |
| `SUPABASE_URL` | `https://edxfhpdyxlenkrxsnirb.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | 対象プロジェクトの `sb_publishable_` キー。secret/service_role不可 |
| `PORT` | 既定3000 |
| `HOST` | 既定127.0.0.1。ホスティングの要件に応じて設定 |

`npm start` で起動。開発のみ `ATS_ORIGIN=http://127.0.0.1:3000` を使用可能。開発CookieはHTTP用、本番Cookieは `__Host-` prefixとSecure付き。外部公開時はHTTPS終端の後ろに置き、HTTP→HTTPSリダイレクト、外部HostをそのままNodeへ転送、API/認証応答のCDNキャッシュ無効、Nodeの直接外部アクセスを遮断する。信頼できない `X-Forwarded-*` を認証やIP判定に使用しません。

配信は3つのHTML・api.js・DOMPurifyのみの許可リスト。リポジトリ全体を別の静的サーバーで公開しないでください。CSP/frame-ancestors、nosniff、DENY、no-referrer、no-store、HTTPS時HSTSはNodeから返却します。

## Supabase反映済み

接続先 `edxfhpdyxlenkrxsnirb`。13テーブル、会社別RLS、役割権限、非公開 `applicant-files`、選考履歴、原子的な一括更新、send-mail Functionを配置済み。`db/ats_schema.sql` と `db/ats_bulk_update.sql` は適用記録であり再実行不要。旧プロジェクトからのデータ移行なし。初期管理者作成済み。

追加ユーザーはSupabase Authenticationで作成・確認後、`db/provision_member.sql` の値を設定して実行。AuthアカウントだけではATSへ入れません。パスワード・秘密鍵をチャット/Gitへ記載しないでください。

## 管理画面で残っている設定

2026-09-29の公開Auth settings読取: `disable_signup=false`、メール確認あり、匿名ログイン無効、email providerのみ有効。

- Authentication → Sign In / Providers → Allow new users to sign up を無効にする（招待制）。プラグインに設定変更機能がなく、クラウドブラウザはサインイン待ちのため未変更。
- 漏洩済みパスワード保護は無効（Advisor警告1件）。公式資料ではPro以上。課金変更は行っていません。利用プランで可能なら有効化。
- パスワード最低長・文字条件、MFA、Authレート制限を管理画面で確認する。アプリのログイン制限はメール単位5回/15分、全体100回/分。Supabase直アクセスにはこのアプリ制限は適用されないためAuth側の保護も必要。
- 公開origin決定後にAuth Site URL/redirect許可先を必要なものだけへ合わせる。

## メール

Supabase Function Secretsに `RESEND_API_KEY`、`ATS_MAIL_FROM`（認証済みドメイン）、`ATS_ALLOWED_ORIGINS`（直接ブラウザ呼出を許可する場合のみ）を設定。新Node経由の送信ではブラウザのOrigin/CookieをSupabaseへ転送しません。FunctionはAuthユーザーと役割を再検証します。秘密値はNode/HTMLへ埋め込まないでください。実配送未確認。

## 検証と公開ゲート

`npm ci && npm test`。インラインJS更新後は `npm run security:headers` を実行してCSPハッシュを更新。検証結果と限界は `docs/SECURITY_REVIEW.md`。

現時点では未公開です。公開先でHTTPS/Secure Cookie/非キャッシュを確認し、本人の実ログイン→候補者追加→書類→面接官権限→ログアウトを試験してから実データを投入してください。写真の永続化、パスワード再設定画面、MFA導線はまだ未実装です。
