"use strict";

/* Bandeau d'information de mise à jour, fermable. La fermeture est retenue
 * dans le navigateur pour ne plus l'afficher aux visites suivantes. */

(function () {
  const BANNER_KEY = "reliques.banner.v2.closed";

  /**
   * Indique si le bandeau a déjà été fermé dans ce navigateur.
   * @returns {boolean} true si le bandeau a été fermé.
   */
  function isClosed() {
    try {
      return localStorage.getItem(BANNER_KEY) === "1";
    } catch (e) {
      return false;
    }
  }

  /**
   * Retient la fermeture du bandeau (sans effet si le stockage est bloqué).
   * @returns {void}
   */
  function rememberClosed() {
    try {
      localStorage.setItem(BANNER_KEY, "1");
    } catch (e) {
      // Stockage indisponible : le bandeau réapparaîtra au prochain chargement.
    }
  }

  /**
   * Affiche le bandeau s'il n'a pas été fermé et branche le bouton de fermeture.
   * @returns {void}
   */
  function initBanner() {
    const banner = document.getElementById("update-banner");
    if (!banner || isClosed()) return;
    banner.hidden = false;
    banner.querySelector(".banner-close").addEventListener("click", function () {
      banner.hidden = true;
      rememberClosed();
    });
  }

  initBanner();
})();
