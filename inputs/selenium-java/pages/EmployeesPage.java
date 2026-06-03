package com.beacon.hr.pages;

import com.beacon.hr.helpers.DriverFactory;
import org.openqa.selenium.By;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.interactions.Actions;
import org.openqa.selenium.support.FindBy;
import org.openqa.selenium.support.How;
import org.openqa.selenium.support.PageFactory;
import org.openqa.selenium.support.ui.ExpectedConditions;
import org.openqa.selenium.support.ui.WebDriverWait;

import java.time.Duration;

public class EmployeesPage {

    private static final String URL = "https://hr.beacon.test/employees";

    private final WebDriver driver;
    private final WebDriverWait wait;

    @FindBy(id = "search-employees") private WebElement searchInput;
    @FindBy(how = How.XPATH, using = "//header//button[contains(., 'Add')]") private WebElement addBtn;
    @FindBy(css = ".invite-modal .send-btn") private WebElement sendInviteButton;

    public EmployeesPage() {
        this.driver = DriverFactory.get();
        this.wait = new WebDriverWait(driver, Duration.ofSeconds(10));
        PageFactory.initElements(driver, this);
    }

    public void open() {
        driver.get(URL);
    }

    public void search(String query) throws InterruptedException {
        searchInput.clear();
        searchInput.sendKeys(query);
        Thread.sleep(1500);
    }

    public int rowCount() {
        return driver.findElements(By.cssSelector(".employees-grid .row")).size();
    }

    public String firstRowName() {
        return driver.findElements(By.cssSelector(".employees-grid .row .name")).get(0).getText();
    }

    public void openInviteModal() throws InterruptedException {
        new Actions(driver).moveToElement(addBtn).click().perform();
        Thread.sleep(1000);
        wait.until(ExpectedConditions.visibilityOfElementLocated(By.cssSelector(".invite-modal")));
    }

    public void inviteEmail(String email) throws InterruptedException {
        driver.findElements(By.cssSelector(".invite-modal input")).get(0).sendKeys(email);
        sendInviteButton.click();
        Thread.sleep(1200);
    }

    public String inviteToastText() {
        return driver.findElement(By.xpath("//div[contains(@class,'toast')]/span[2]")).getText();
    }
}
