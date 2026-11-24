# StartFest

Site mobile-first de gerenciamento de listas da Resenha Start Fest, para divulgar eventos e receber listas de convidados. A interface usa Vite + TypeScript.

## Desenvolvimento

```sh
npm install
npm run dev
```

Copie `.env.example` para `.env.local` e preencha `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` para carregar eventos publicados do Supabase e habilitar inscrições. A chave anon é pública e protegida pelas políticas RLS; nunca coloque a service-role key no frontend. Sem essas variáveis, a página mostra eventos demonstrativos e mantém o envio desabilitado.

```sh
npm run build
```

Execute os testes da função de inscrição com `npm test`. O arquivo `tests/email_registration.sql` verifica a migration em uma transação que deve ser revertida após o teste.

## GitHub Pages

O workflow gera e publica o site em pushes para `main`; pull requests executam apenas o build. Em **Settings > Pages > Build and deployment**, selecione **GitHub Actions**. Em **Settings > Secrets and variables > Actions**, cadastre a URL do projeto como variável `VITE_SUPABASE_URL` e a chave pública anon como segredo `VITE_SUPABASE_ANON_KEY`. No repositório `resenhastartfest/lista`, o endereço esperado é `https://resenhastartfest.github.io/lista/`; o build usa `/lista/` como caminho base, enquanto o desenvolvimento local usa `/`. Sem as configurações do Supabase, o site mostra eventos demonstrativos e não aceita inscrições.

## Supabase

1. Para um projeto novo do Supabase, vincule-o com `npx supabase link --project-ref SEU_PROJECT_REF` e aplique todas as migrations com `npx supabase db push --remote`. Para continuar usando o projeto existente, preserve o banco e confira as migrations pendentes antes de aplicá-las; o código no Git não copia automaticamente eventos, listas, usuários ou arquivos do Storage para outro projeto.
2. Configure os segredos da função `submit-guest-list`: `RATE_LIMIT_SECRET` (segredo aleatório) e `ALLOWED_ORIGINS=https://resenhastartfest.github.io,http://localhost:5173` (origens exatas separadas por vírgula, sem caminho nem curingas). Se o site antigo continuar em uso com o mesmo Supabase, inclua também `https://ednilsontheedmaster.github.io` na lista; mantenha outras origens necessárias. O Supabase fornece `SUPABASE_SERVICE_ROLE_KEY` automaticamente à função; ela nunca deve ser publicada no site.
3. Implante a função com `npx supabase functions deploy submit-guest-list`. A configuração de autenticação e os administradores pertencem ao projeto Supabase; um projeto novo exige sua própria configuração e criação de usuários.

A função valida cada pessoa, exige consentimento, limita listas a dez pessoas e aplica limite de envios por janela usando um identificador HMAC do IP. Escritas são atômicas e acessíveis somente à função com a chave de serviço; o navegador nunca recebe essa chave. RLS permite leitura pública apenas de eventos publicados e reserva os dados pessoais da lista aos usuários autenticados cujo `app_metadata.role` seja `admin`.

Novas inscrições oferecem as opções Homem, Mulher e Casal. Os registros antigos de Pista e VIP mantêm seus valores originais e são identificados como antigos na administração; não são convertidos automaticamente.

As tabelas `guest_list_submissions` e `guest_list_entries` separam cada envio de seus convidados e permitem agregações futuras por evento e tipo de entrada. Cada novo envio exige o e-mail do responsável e consentimento para registro e confirmação. Uma restrição única impede duas listas do mesmo e-mail no mesmo evento, ignorando diferenças entre maiúsculas e minúsculas; o mesmo e-mail pode ser usado em eventos diferentes. Inscrições anteriores sem e-mail são preservadas e não podem ser identificadas como duplicatas pelo endereço. O campo `whatsapp_phone` fica reservado no banco, mas não é solicitado nem usado. Eventos são ocultados e deixam de aceitar inscrições no horário de início, sem serem excluídos do banco.

### Confirmação por e-mail

O envio utiliza a [Gmail API](https://developers.google.com/workspace/gmail/api/guides/sending), sem exigir domínio próprio. A conta autorizada envia as mensagens; os visitantes não precisam ter Gmail. O Google recebe o endereço do responsável e o nome do evento. Prepare uma conta Gmail dedicada e observe os [limites de envio](https://support.google.com/mail/answer/22839).

O logotipo no e-mail é carregado pela URL pública `https://resenhastartfest.github.io/lista/startfest-logo.jpeg`; mantenha esse endereço disponível ou atualize-o na função ao mudar a hospedagem. O texto da confirmação permanece legível se o cliente de e-mail bloquear imagens.

1. No [Google Cloud Console](https://console.cloud.google.com/), crie ou selecione um projeto e ative **Gmail API** em **APIs e serviços > Biblioteca**.
2. Em **Google Auth Platform**, configure a tela de consentimento, selecione público externo e adicione a própria conta Gmail como usuário de teste. Solicite apenas o escopo `https://www.googleapis.com/auth/gmail.send`.
3. Crie um cliente OAuth do tipo **Aplicativo da Web**, adicionando `https://developers.google.com/oauthplayground` como URI de redirecionamento autorizado. Guarde o ID e o segredo do cliente.
4. No [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/), abra a engrenagem, marque **Use your own OAuth credentials**, informe o ID e o segredo do cliente e mantenha **Access type: Offline**. No passo 1, informe o escopo `https://www.googleapis.com/auth/gmail.send` e autorize com a conta que enviará os e-mails. No passo 2, selecione **Exchange authorization code for tokens** e guarde o **refresh token**. Não compartilhe links do Playground com credenciais ou tokens.
5. No projeto Supabase, em **Edge Functions > Secrets**, configure `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` e `EMAIL_FROM` (o endereço Gmail autorizado, sem nome ou sinais `< >`). Não remova os segredos existentes. Não envie essas credenciais ao chat, nem as coloque no frontend ou no Git.

O escopo de envio é sensível. Com o aplicativo OAuth externo em **Testing**, o refresh token expira em sete dias; para uso contínuo, publique o aplicativo e siga as eventuais exigências de verificação do Google. O Google pode revogar tokens e aplicar limites ou bloqueios; acompanhe o funcionamento e as políticas antes de usá-lo em produção. Consulte a [documentação OAuth](https://developers.google.com/identity/protocols/oauth2) e a [classificação dos escopos](https://developers.google.com/workspace/gmail/api/auth/scopes).

Aplique a migration, publique a função `submit-guest-list` e o frontend de forma coordenada: versões antigas não enviam e-mail e deixarão de cadastrar após a atualização do backend. Sem as configurações ou se o Google recusar a chamada, a inscrição continua salva, mas o visitante é avisado de que o envio não foi confirmado. A aceitação pela API não garante entrega; falhas ou timeouts não são repetidos automaticamente e um timeout pode ocorrer após o envio. Não há webhook de status de entrega.

## Administração

1. Aplique todas as migrations pendentes no projeto vinculado: `npx supabase db push --remote`. A migration administrativa cria o bucket público `event-posters`, restringe uploads a administradores e permite que eles editem ou excluam convidados. Eventos são retirados da agenda por cancelamento, sem apagar seu histórico.
2. No Supabase, em **Authentication > Users**, crie o usuário com e-mail e senha. Pelo SQL Editor, atualize **somente o usuário desejado** com o papel administrativo, substituindo o endereço abaixo e verificando que uma única linha foi alterada:

   ```sql
   update auth.users
   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
   where email = 'admin@example.com';
   ```

   Use `app_metadata`, nunca `user_metadata`: usuários comuns podem alterar seus próprios `user_metadata`. O administrador deve sair e entrar novamente para atualizar o token após mudança de papel. Proteja a conta e não compartilhe a senha.
3. Publique o build e acesse `admin.html` pelo link Administração no rodapé. Entre com a conta configurada. O cliente usa a URL e chave pública do projeto; a autorização é aplicada no banco e no Storage, não por uma chave de serviço no navegador.
4. Em **Novo evento**, informe os dados e selecione uma imagem JPEG, PNG ou WebP de até 5 MB. Escolha **Publicado** para aparecer na agenda, **Rascunho** para manter privado ou **Cancelado** para ocultar. Datas são informadas no horário de Brasília (UTC−03:00); horários futuros devem ser revisados caso o fuso ou horário de verão mude. Ao substituir uma imagem, a anterior permanece no Storage até uma limpeza administrativa deliberada.
5. Em **Ver lista**, consulte, corrija ou exclua convidados individualmente. Exclusões de convidados são permanentes; retirar um evento da agenda preserva as inscrições. Para encaminhar a lista completa, escolha **Preparar e-mail**, informe o destinatário e anexe manualmente o CSV baixado no aplicativo de e-mail antes de enviar. Confira o destinatário antes de compartilhar dados pessoais.

O bucket de cartazes é público, portanto não envie documentos pessoais ou imagens privadas. CSVs baixados contêm dados pessoais: mantenha-os protegidos e descarte-os quando não forem mais necessários. Limpeza de imagens antigas no Storage não deve remover cartazes ainda usados por eventos.

## Conteúdo e identidade visual

Os três eventos incluídos são demonstrativos e estão espelhados na migration; substitua-os pela programação oficial antes de publicar. `public/startfest-logo.jpeg` usa o logo fornecido; `public/favicon.png` é um recorte otimizado da mesma arte. A paleta foi amostrada diretamente do arquivo: preto `#0A0A0A`, verde `#053F0C`, dourado `#E9B142` e branco `#F4F1EC`.
