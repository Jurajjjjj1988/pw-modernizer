package tests;


import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.is;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

import base.BaseTests;
import pages.HomePage;
import pages.LoginPage;

public class HomePageTests extends BaseTests {
	
	@Test
	public void testAcessarUrlInventory_deveNegarAcessoSemLogin() {
		
	}
	
	@Test
	public void testContarProdutos_deveContarSeisProdutosDiferentes() {
		LoginPage loginPage = new LoginPage(driver);
		HomePage homePage = loginPage.fazerLogin();
		assertThat(homePage.contarProdutos(), is(6));
	}
	
	@Test
	public void testMostrarTituloPaginaProducts_deveMostrarTituloProducts() {
		LoginPage loginPage = new LoginPage(driver);
		HomePage homePage = loginPage.fazerLogin();
		String products = homePage.mostrarTitulo().toLowerCase();
		Assertions.assertEquals("products", products);
		
	}
	
	@Test
	public void testFazerLogOut_deveDeslogarVoltarPaginaLogin() {
		LoginPage loginPage = new LoginPage(driver);
		HomePage homePage = loginPage.fazerLogin();
		homePage.clicarBotaoMenu();
		homePage.clicarLinkLogOut();
		String url = homePage.obterUrlPaginaLogin();
		Assertions.assertEquals("https://www.saucedemo.com/",url);
			
	}
	
	@Test
	public void testClicarMenuDropDown_deveClicarOpcaoNameAtoZ() {
		LoginPage loginPage = new LoginPage(driver);
		HomePage homePage = loginPage.fazerLogin();
		homePage.clicarMenuDropDown("");
		
	}
}
 