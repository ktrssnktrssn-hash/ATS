# 公開前セルフレビュー — 2026-09-29

対象: PR #1 の静的HTML/JavaScript、接続先 edxfhpdyxlenkrxsnirb の実DB権限。認証迂回がないことの絶対保証や第三者による侵入試験ではありません。

## 結果

HTMLの認証チェックを消したりlocalStorageのroleをadminへ書き換えるだけで、候補者データにアクセスできる経路は今回の範囲では確認されませんでした。UIの表示自体は利用者が変更できますが、権限はSupabaseの署名済みトークンとDBの有効プロフィールで決まります。HTMLに管理者パスワード・service_role/secret keyはありません。publishable keyは公開を前提としたキーです。

- 実HTTP: 公開キーのみでapplicantsを取得→401。偽JWTを付けた同じ取得→401。
- 実DB: 13テーブルすべてRLS有効、匿名テーブル権限なし。プロフィール書き換えによる自己昇格拒否、他社の読み書き拒否、担当面接官の範囲、無効/未登録ユーザー拒否、Storage会社間アクセス拒否、クライアントからメール予約RPC呼出拒否を確認。fixtureはROLLBACK済み。
- 関数: 公開RPCはSECURITY INVOKER。メール予約はservice_roleのみ。内部SECURITY DEFINERは非公開スキーマに置き、固定search_pathと現在ユーザーの確認あり。
- 書類: private bucket。署名URLは5分有効で、そのURLの所持者は期間内アクセス可能。ユーザー無効化で発行済み署名URLが即時無効になる設計ではありません。
- メールFunction: サーバー側ユーザー検証・役割検証あり。送信先はDBから確定。モック試験で確認し、実配送は未実施。
- 16件のNode/jsdom/モックFunctionテスト成功。偽トークンとlocalStorage管理者偽装の拒否、サーバー権限での上書きを追加。

## 修正

3画面へContent Security Policyを追加。実行可能なインラインJSはSHA-256で固定し、インラインイベントハンドラ・eval・外部スクリプト・外部フォーム送信・baseタグを制限。接続先は対象Supabaseのみ、画像は同一originまたはdata URLのみ。これはDOMPurifyに加える防御です。

インラインスクリプト変更時は `node scripts/update-csp.cjs` を実行してから `npm test`。jsdomはCSPを強制しないため、テストはポリシー内容/ハッシュと画面ロジックを検証するもので、実ブラウザでのCSP検証の代替ではありません。

新規タブはnoopener/noreferrer、ページ全体はno-referrer。候補者詳細URLのIDをエンコード。

## 未完了・公開条件

1. Security Advisorsが漏洩済みパスワード保護の無効を1件報告。現在のプラグインにはAuth設定更新機能がなく未変更。管理画面で利用可否を確認して有効化する。以前の「指摘0件」は今回の最新結果に置き換える。
   https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection
2. Authのsignup公開設定、パスワードポリシー、レート制限、MFA、セッション失効時間は包括的には確認できていない。未登録者がAuthアカウントを作れても、ATSプロフィールがなければDBアクセスはできない。
3. 公開先でHTTPSとHTTPレスポンスヘッダー `Content-Security-Policy: frame-ancestors 'none'`、`X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY` を設定する。frame-ancestorsはmetaタグでは効かない。HTML/JSと必要静的ファイルだけを公開し、SQL・テスト・設定手順は配信しない。
4. 公開後、実ブラウザで正常ログイン・ログアウト・権限拒否・CSP・書類取得を確認する。まだ公開していない。
5. トークンはlocalStorage保存でHttpOnly cookieではない。XSS発生時のセッション窃取リスクは残るため、本番で実個人情報を扱う前にHttpOnly cookieを使うサーバー構成への移行と追加レビューを検討する。今回のCSPはこれを完全解消しない。
