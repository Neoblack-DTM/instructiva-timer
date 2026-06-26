# Instructiva Timer

Timer 1 para campanhas de e-mail marketing com contagem regressiva evergreen.

## O que ele faz

- Calcula automaticamente a próxima **terça-feira às 19:00** usando o timezone da pessoa que abriu o e-mail.
- Se não for possível detectar o fuso, usa fallback oficial **America/Sao_Paulo**.
- Se hoje for terça e ainda não for 19h, o estado mostrado é `HOJE`.
- Se a terça for no dia seguinte, mostra `AMANHÃ`.
- Demais casos mostram `PRÓXIMA TERÇA`.
- Gera um **GIF animado** no endpoint para uso dentro de `<img>` em e-mail.
- O GIF tem 60 frames de 1 segundo, para a regressão de segundos aparecer ao abrir o e-mail.
- O visual segue o design system da Escola Instructiva: fundo preto, card grafite, destaque laranja e tipografia Montserrat.

Observação de timezone:

- O timer tenta detectar `timezone` via headers de request (`x-vercel-ip-timezone`, `x-vercel-timezone` etc.).
- Se não houver timezone de request, usa país de origem (`x-vercel-ip-country`) como fallback.
- Também aceita override por query string para testes: `?tz=America/Sao_Paulo`.

## Estrutura

- `api/timer.gif.js` → endpoint usado no email (`/api/timer.gif`).
- `public/timer-demo.html` → preview e documentação rápida.

## Estados possíveis do timer

1) `HOJE`
- A contagem está para a terça da semana atual e ainda não passou das 19h.

2) `AMANHÃ`
- A próxima terça está no dia seguinte.

3) `PRÓXIMA TERÇA`
- A terça não é nem hoje nem amanhã.

## Uso no e-mail

No template do e-mail, insira:

```html
<img
  src="https://seu-dominio.vercel.app/api/timer.gif"
  alt="Contagem regressiva para a próxima aula"
  width="640"
  height="260"
  style="border:0; display:block;"
/>
```

Para testes com timezone explícito:

```html
<img
  src="https://seu-dominio.vercel.app/api/timer.gif?tz=America/Sao_Paulo"
  alt="Contagem regressiva para a próxima aula"
  width="640"
  height="260"
  style="border:0; display:block;"
/>
```

Para reduzir cache indesejado no e-mail, pode usar `?v={{timestamp}}` no `src` também.

## Rodar localmente

```bash
npm install
npm run dev
```

## Deploy no Vercel

Endpoint final:
- `https://[seu-projeto].vercel.app/api/timer.gif`
