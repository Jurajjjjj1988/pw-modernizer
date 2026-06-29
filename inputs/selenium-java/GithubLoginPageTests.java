package tests;

//O import static é do método em particular
import static org.junit.jupiter.api.Assertions.assertEquals;
import org.junit.jupiter.api.Test;

import base.BaseTests;
import pages.LoginPage;

public class LoginPageTests extends BaseTests {

	@Test
	public void testFazerLoginComSucesso_deveAbrirHomePage() {
		// Pré-requisitos
		LoginPage loginPage = new LoginPage(driver);
		carregarPaginaInicial();
		loginPage.preencherUsuario("standard_user");
		loginPage.preencherSenha("secret_sauce");
		loginPage.clicarBotaoLogin();

	}

	@Test
	public void testAcessarPaginaInventory_deveNegarAcessoSemUsuarioLogado() {
		LoginPage loginPage = new LoginPage(driver);
		carregarPaginaInicial();
		loginPage.carregarPaginaInventory();

		// Mensagem de negação de acesso esperada
		String msgEsperada = "Epic sadface: You can only access '/inventory.html' when you are logged in.";
		
		// Mensagem obtida pela Webdriver
		String msgObtida = loginPage.carregarMensagemErroAcessoSemLogin();

		assertEquals(msgEsperada, msgObtida);

	}

}
