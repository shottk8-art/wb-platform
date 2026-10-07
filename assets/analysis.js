(function () {
  const root = () => document.getElementById("aiAnalysisCard");
  function reset() {
    const card = root(); if (!card) return;
    card.dataset.state = "idle";
    card.querySelector("#aiAnalysisResult").hidden = true;
    card.querySelector("#aiAnalysisIntro").hidden = false;
    card.querySelector("#aiAnalysisError").hidden = true;
    card.querySelector("#aiAnalyzeBtn").disabled = false;
    card.querySelector("#aiAnalyzeBtn span").textContent = "Проанализировать результаты";
  }
  function addItems(container, items, type) {
    container.replaceChildren();
    items.forEach((item) => {
      const article = document.createElement("article");
      article.className = `ai-analysis-item ai-analysis-item--${type === "insight" ? item.tone : item.priority}`;
      const title = document.createElement("strong"); title.textContent = item.title;
      const detail = document.createElement("p"); detail.textContent = item.detail;
      article.append(title, detail); container.append(article);
    });
  }
  async function analyze(context) {
    const card = root(), button = card.querySelector("#aiAnalyzeBtn"), intro = card.querySelector("#aiAnalysisIntro"), result = card.querySelector("#aiAnalysisResult"), error = card.querySelector("#aiAnalysisError");
    button.disabled = true; button.querySelector("span").textContent = "Анализирую…"; card.dataset.state = "loading"; result.hidden = true; error.hidden = true;
    try {
      const { data, error: invokeError } = await window.supabaseClient.functions.invoke("analyze-results", { body: context });
      if (invokeError) {
        let message = data?.error;
        if (!message && invokeError.context?.json) {
          try { message = (await invokeError.context.json()).error; } catch (_) { /* ответ без JSON */ }
        }
        throw new Error(message || invokeError.message);
      }
      if (!data?.analysis) throw new Error(data?.error || "Пустой ответ");
      const analysis = data.analysis; card.dataset.state = analysis.health || "neutral";
      card.querySelector("#aiAnalysisSummary").textContent = analysis.summary;
      addItems(card.querySelector("#aiInsights"), analysis.insights || [], "insight");
      addItems(card.querySelector("#aiActions"), analysis.actions || [], "action");
      const caveats = card.querySelector("#aiCaveats"); caveats.replaceChildren();
      (analysis.caveats || []).forEach((text) => { const item = document.createElement("li"); item.textContent = text; caveats.append(item); });
      caveats.parentElement.hidden = !analysis.caveats?.length;
      intro.hidden = true; result.hidden = false; button.querySelector("span").textContent = data.cached ? "Анализ актуален" : "Обновить анализ";
    } catch (cause) {
      card.dataset.state = "error"; error.textContent = cause.message || "Не удалось выполнить анализ"; error.hidden = false; button.querySelector("span").textContent = "Попробовать снова";
    } finally { button.disabled = false; }
  }
  window.WBAnalysis = { analyze, reset };
})();
