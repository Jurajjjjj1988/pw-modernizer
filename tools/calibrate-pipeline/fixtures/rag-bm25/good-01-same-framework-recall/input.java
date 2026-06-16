import org.junit.jupiter.api.Test;
import org.openqa.selenium.By;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.support.ui.WebDriverWait;

class AuthFlowTest {
    @Test
    void userCanLogIn() throws InterruptedException {
        ChromeDriver driver = new ChromeDriver();
        driver.get("https://example.com/login");
        Thread.sleep(2000);
        new WebDriverWait(driver, 5).until(d -> d.findElement(By.id("login")));
        driver.quit();
    }
}
