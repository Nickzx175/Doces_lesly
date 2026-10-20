# Doces da Lesly — Node.js + JavaScript

Projeto inicial de loja virtual responsiva para VS Code/Windows.

## Requisitos
- Node.js LTS (recomendado Node 22 ou 24).
- VS Code.
- Internet para instalar as dependências e usar o checkout online.

## Instalar no Windows
1. Baixe e extraia `Doces_da_Lesly_Node.zip`.
2. Abra a pasta extraída no VS Code (`Arquivo > Abrir Pasta`).
3. Abra o terminal do VS Code (`Terminal > Novo Terminal`).
4. Confira a instalação:
   ```powershell
   node -v
   npm -v
   ```
5. Instale as dependências:
   ```powershell
   npm install
   ```
   Se o PowerShell bloquear `npm.ps1`, use:
   ```powershell
   npm.cmd install
   ```
6. Crie o arquivo `.env` copiando `.env.example`. No Explorador de Arquivos, copie e renomeie `.env.example` para `.env`.
7. Inicie o site:
   ```powershell
   npm run dev
   ```
   ou:
   ```powershell
   npm.cmd run dev
   ```
8. Abra `http://localhost:3000`.

## Como testar
- Adicione doces ao carrinho.
- Preencha nome, telefone e endereço ou escolha retirada.
- Escolha Pix ou cartão.
- Sem credencial Mercado Pago, o servidor salva um pedido de demonstração no arquivo `data/orders.json`; não cobra dinheiro.
- Para encerrar o servidor, pressione `Ctrl + C` no terminal.

## Ativar o checkout Mercado Pago
1. Crie/acesse uma conta de vendedor no Mercado Pago.
2. No painel de desenvolvedor, crie uma aplicação e obtenha credenciais de TESTE.
3. Cole o Access Token de teste no campo `MERCADOPAGO_ACCESS_TOKEN` do `.env`.
4. Ajuste `BASE_URL` para a URL pública HTTPS quando publicar o site. O webhook em localhost não recebe notificações externas.
5. Teste o checkout com credenciais e cartões de teste oficiais do Mercado Pago. Pix pode depender das configurações/país/conta disponíveis no checkout.
6. Antes de aceitar pagamentos reais, configure a URL pública, valide a assinatura do webhook de acordo com a documentação atual do Mercado Pago, proteja o painel administrativo e teste o fluxo completo.
7. Quando estiver pronto, substitua a credencial de teste pela de produção, mantendo-a somente no servidor.

## Importante
- Não publique `.env` nem envie o Access Token para ninguém.
- Esta é uma base de desenvolvimento, não um e-commerce pronto para produção.
- A entrega aparece como “a combinar”; implemente taxa por região antes de vender.
- Os produtos e preços são exemplos e devem ser confirmados pela loja.
- O painel administrativo ainda não foi implementado; a rota `/api/admin/orders` retorna 501 de propósito. Os pedidos são gravados localmente em JSON, o que serve para desenvolvimento mas não é adequado para uma loja com vários processos/servidores.
- Para produção, use banco de dados gerenciado (ex.: PostgreSQL), autenticação de administradora, política de privacidade, HTTPS, validação de webhook e revisão de segurança.


## Controle privado de vendas a prazo (novo)
- Acesse `/admin` no domínio da loja.
- O navegador solicitará usuário e senha. Configure `ADMIN_USER` e `ADMIN_PASSWORD` nas variáveis de ambiente do Render antes de usar. Use uma senha longa, única, e não compartilhe.
- Registre cliente, descrição, data da compra, valor e vencimento.
- O painel calcula total vendido, recebido e saldo em aberto para o período filtrado pela data da compra.
- É possível registrar pagamentos parciais; o saldo é atualizado e a venda fica quitada quando chega a zero.
- As APIs administrativas exigem autenticação. A página usa `noindex` como medida adicional, não como controle de acesso.

## Aviso importante sobre persistência
Esta primeira versão guarda vendas a prazo em `data/credit-sales.json`, assim como os pedidos em `data/orders.json`. No Render Free, arquivos locais podem ser apagados em novos deploys ou reinicializações. **Não use para guardar dívidas reais de clientes até migrarmos para um banco de dados persistente (recomendado PostgreSQL) e configurarmos backups.** Configure `ADMIN_PASSWORD` nas variáveis de ambiente do Render; sem ela, o painel permanece desativado. O `.env` nunca deve ser enviado ao GitHub.
