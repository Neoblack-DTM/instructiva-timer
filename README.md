# Instructiva Timer

Timer 1 para campanhas de e-mail marketing com contagem regressiva evergreen.

## O que ele faz

- Calcula automaticamente a próxima **terça-feira às 19:00 (BRT)**.
- Se hoje for terça e ainda não for 19h, o estado mostrado é `HOJE`.
- Se a terça for no dia seguinte, mostra `AMANHÃ`.
- Demais casos mostram `PRÓXIMA TERÇA`.
- Gera a imagem em **GIF** no endpoint para uso dentro de `<img>` em e-mail.

## Estrutura

- `api/timer.gif.js` → endpoint usado no email (`/api/timer.gif`).
- `public/timer-demo.html` → preview e documentação rápida.

## Estados possíveis do timer

1) `HOJE`
- A contagem está para a terça da semana atual e ainda não passou das 19h.

2) `AMANHÃ`
- A próxima terça está no dia seguinte.

3) `PRÓXIMA TERÇA`
- A terça não é nem hoje e nem amanhã.

## Uso no e-mail

No template do e-mail, insira:

```html
<img
  src="https://seu-dominio.vercel.app/api/timer.gif"
  alt="Timer 1"
  width="820"
  height="320"
  style="border:0; display:block;"
/>
```

Para evitar cache agressivo do cliente de e-mail e forçar recálculo em acessos novos,
configuramos cabeçalhos `no-cache` na resposta.

## Rodar localmente

```bash
npm install
npm run dev
```

## Deploy no Vercel

Endpoint final:
- `https://[seu-projeto].vercel.app/api/timer.gif`
